import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  BucketIamPolicy,
  CopyObject,
  CreateBucket,
  ListResponse,
  ObjectRef,
  ObjectsPage,
  OperationSummary,
  SetBucketIam,
  StorageBucket,
  StorageCapabilities,
  StorageObject,
  UpdateBucket,
  UpdateObject,
} from '@nephoscope/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { lroPoller, operationGetter } from '../../core/gcp/lro.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { createOptions, mapBucket, mapObject, mapPolicy, updatePatch } from './storage-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: SDK objects are loosely typed at this boundary.
type Any = any;

/** Past this many objects, Nephoscope will not count or empty a bucket itself (D-10). */
export const COUNT_CAP = 1_000_000;
const DELETE_CONCURRENCY = 16;

/**
 * The emulator's base URL. SDK v8 reads STORAGE_EMULATOR_HOST itself and then builds upload URLs
 * wrong unless the variable carries /storage/v1, which other tools do not expect; Nephoscope
 * accepts either form and passes the endpoint explicitly (SPEC-0001 D-18).
 */
export function emulatorEndpoint(host: string | null): string | null {
  if (!host) return null;
  const withScheme = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, '').replace(/\/storage\/v1$/, '');
}

/** Cloud Storage (SPEC-0006 D-09 to D-12). */
@Injectable()
export class StorageService {
  readonly emulator: string | null;

  constructor(
    private readonly factory: GcpClientFactory,
    private readonly operations: OperationsService,
    @Inject(NEPHOSCOPE_CONFIG) config: NephoscopeConfig,
  ) {
    this.emulator = emulatorEndpoint(config.emulators.storage);
    delete process.env.STORAGE_EMULATOR_HOST;
  }

  async storage(profileId: string, projectId: string): Promise<Any> {
    const { Storage } = await sdk.storage();
    return this.factory.get(profileId, `storage:${projectId}`, (auth) =>
      this.emulator
        ? new Storage({ projectId, apiEndpoint: this.emulator, useAuthWithCustomEndpoint: false })
        : new Storage({ projectId, authClient: auth as never }),
    );
  }

  private async control(profileId: string, feature: string): Promise<Any> {
    if (this.emulator)
      throw ProblemException.of('FAILED_PRECONDITION', `${feature} is not available with the storage emulator.`, {
        reason: 'EMULATOR_UNSUPPORTED',
      });
    const { StorageControlClient } = await sdk.storageControl();
    return this.factory.get(profileId, 'storage-control', (auth) => new StorageControlClient({ auth: auth as never }));
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, bucket: string | null) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'storage',
      kind,
      resource: { name, displayName, href: bucket ? `/p/${projectId}/storage/${encodeURIComponent(bucket)}` : null },
    });
  }

  capabilities(h: ProfileHandle): StorageCapabilities {
    const type = h.profile.type;
    const canSign = !this.emulator && (type === 'service_account' || type === 'impersonated_service_account');
    return { canSign, signingAccount: canSign ? h.profile.principal : null, emulator: !!this.emulator };
  }

  // ---- buckets -----------------------------------------------------------------------------------

  async buckets(h: ProfileHandle, projectId: string): Promise<ListResponse<StorageBucket>> {
    const s = await this.storage(h.profile.id, projectId);
    const [buckets] = await s.getBuckets();
    return {
      items: (buckets as Any[]).map((b) => mapBucket(b.metadata)).sort((a, b) => a.name.localeCompare(b.name)),
      nextPageToken: null,
    };
  }

  async bucket(h: ProfileHandle, projectId: string, name: string): Promise<StorageBucket> {
    const [m] = await (await this.storage(h.profile.id, projectId)).bucket(name).getMetadata();
    return mapBucket(m);
  }

  async bucketRaw(h: ProfileHandle, projectId: string, name: string): Promise<unknown> {
    const [m] = await (await this.storage(h.profile.id, projectId)).bucket(name).getMetadata();
    return m;
  }

  async createBucket(h: ProfileHandle, projectId: string, body: CreateBucket): Promise<StorageBucket> {
    const [b] = await (await this.storage(h.profile.id, projectId)).createBucket(body.name, createOptions(body));
    this.record(h, projectId, 'storage.bucket.create', body.name, `Create bucket ${body.name}`, body.name);
    return mapBucket(b.metadata);
  }

  async updateBucket(h: ProfileHandle, projectId: string, name: string, body: UpdateBucket): Promise<StorageBucket> {
    const current = await this.bucket(h, projectId, name);
    if (current.retention?.locked && body.retentionSeconds !== undefined && (body.retentionSeconds ?? 0) < current.retention.periodSeconds)
      throw ProblemException.of('FAILED_PRECONDITION', 'The retention policy is locked: its period can only grow.');
    const [m] = await (await this.storage(h.profile.id, projectId)).bucket(name).setMetadata(updatePatch(body, current));
    this.record(h, projectId, 'storage.bucket.update', name, `Update bucket ${name}`, name);
    return mapBucket(m);
  }

  async lockRetention(h: ProfileHandle, projectId: string, name: string, metageneration: string): Promise<StorageBucket> {
    const b = (await this.storage(h.profile.id, projectId)).bucket(name);
    await b.lock(metageneration);
    this.record(h, projectId, 'storage.bucket.lockRetention', name, `Lock the retention policy of ${name}`, name);
    const [m] = await b.getMetadata();
    return mapBucket(m);
  }

  /** Every object and version, counted page by page up to COUNT_CAP. */
  async countObjects(h: ProfileHandle, projectId: string, name: string, signal?: AbortSignal): Promise<{ count: number; capped: boolean }> {
    const b = (await this.storage(h.profile.id, projectId)).bucket(name);
    let count = 0;
    let pageToken: string | undefined;
    do {
      if (signal?.aborted) break;
      const [files, next]: Any[] = await b.getFiles({
        versions: true,
        maxResults: 1000,
        pageToken,
        autoPaginate: false,
        fields: 'items(name),nextPageToken',
      });
      count += files.length;
      pageToken = next?.pageToken;
      if (count >= COUNT_CAP) return { count: COUNT_CAP, capped: true };
    } while (pageToken);
    return { count, capped: false };
  }

  /** An empty bucket is deleted at once; a full one as a cancellable operation that empties it first. */
  async deleteBucket(
    h: ProfileHandle,
    projectId: string,
    name: string,
    confirmObjects: string | undefined,
  ): Promise<OperationSummary | null> {
    const s = await this.storage(h.profile.id, projectId);
    const b = s.bucket(name);
    const { count, capped } = await this.countObjects(h, projectId, name);
    if (count === 0) {
      await b.delete();
      this.record(h, projectId, 'storage.bucket.delete', name, `Delete bucket ${name}`, null);
      return null;
    }
    if (capped)
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        `This bucket holds more than ${COUNT_CAP.toLocaleString('en-US')} objects. Empty it with a lifecycle rule first.`,
      );
    if ((confirmObjects ?? '').replaceAll(/[,.\s]/g, '') !== String(count))
      throw ProblemException.of('CONFIRMATION_REQUIRED', `Type ${count} to delete the bucket with its ${count} objects.`, {
        errors: [{ path: 'confirmObjects', message: `Must be "${count}"` }],
      });
    return this.operations.trackLocal(
      {
        profileId: h.profile.id,
        projectId,
        product: 'storage',
        kind: 'storage.bucket.delete',
        resource: { name, displayName: `Delete bucket ${name} and its ${count} objects`, href: null },
      },
      async (report, signal) => {
        let deleted = 0;
        for (;;) {
          if (signal.aborted) return `Stopped after ${deleted.toLocaleString('en-US')} objects were deleted; the bucket remains`;
          const [files]: Any[] = await b.getFiles({ versions: true, maxResults: 1000, autoPaginate: false });
          if (files.length === 0) break;
          for (let i = 0; i < files.length; i += DELETE_CONCURRENCY) {
            if (signal.aborted) break;
            await Promise.all(
              files
                .slice(i, i + DELETE_CONCURRENCY)
                .map((f: Any) =>
                  f.delete({ ignoreNotFound: true, ...(f.metadata?.generation ? { generation: f.metadata.generation } : {}) }),
                ),
            );
            deleted += Math.min(DELETE_CONCURRENCY, files.length - i);
            report((deleted / count) * 100, `${deleted.toLocaleString('en-US')} of ${count.toLocaleString('en-US')} objects deleted`);
          }
        }
        await b.delete();
        return `Deleted the bucket and ${deleted.toLocaleString('en-US')} objects`;
      },
    );
  }

  async iam(h: ProfileHandle, projectId: string, name: string): Promise<BucketIamPolicy> {
    const [p] = await (await this.storage(h.profile.id, projectId)).bucket(name).iam.getPolicy({ requestedPolicyVersion: 3 });
    return mapPolicy(p);
  }

  async setIam(h: ProfileHandle, projectId: string, name: string, body: SetBucketIam): Promise<BucketIamPolicy> {
    const b = (await this.storage(h.profile.id, projectId)).bucket(name);
    const hasConditions = body.bindings.some((x) => x.condition);
    const [p] = await b.iam.setPolicy({
      ...(body.etag ? { etag: body.etag } : {}),
      version: hasConditions ? 3 : 1,
      bindings: body.bindings.map((x) => ({ role: x.role, members: x.members, ...(x.condition ? { condition: x.condition } : {}) })),
    });
    this.record(h, projectId, 'storage.bucket.setIam', name, `Update permissions of ${name}`, name);
    return mapPolicy(p);
  }

  // ---- objects ---------------------------------------------------------------------------------------

  async objects(
    h: ProfileHandle,
    projectId: string,
    bucket: string,
    q: { prefix: string; flat: boolean; versions: boolean; softDeleted: boolean; pageToken?: string },
    hierarchical: boolean,
  ): Promise<ObjectsPage> {
    const b = (await this.storage(h.profile.id, projectId)).bucket(bucket);
    const [files, next, resp]: Any[] = await b.getFiles({
      prefix: q.prefix || undefined,
      ...(q.flat ? {} : { delimiter: '/' }),
      ...(hierarchical && !q.flat ? { includeFoldersAsPrefixes: true } : {}),
      ...(q.versions ? { versions: true } : {}),
      ...(q.softDeleted ? { softDeleted: true } : {}),
      maxResults: 1000,
      pageToken: q.pageToken,
      autoPaginate: false,
    });
    return {
      prefixes: [...(resp?.prefixes ?? [])].sort(),
      items: (files as Any[]).map((f) => mapObject(f.metadata)).filter((o) => o.name !== q.prefix || Number(o.size) > 0),
      nextPageToken: next?.pageToken ?? null,
    };
  }

  private file(s: Any, bucket: string, ref: ObjectRef): Any {
    return s.bucket(bucket).file(ref.name, ref.generation ? { generation: ref.generation } : {});
  }

  async object(h: ProfileHandle, projectId: string, bucket: string, ref: ObjectRef): Promise<StorageObject> {
    const [m] = await this.file(await this.storage(h.profile.id, projectId), bucket, ref).getMetadata();
    return mapObject(m);
  }

  async updateObject(h: ProfileHandle, projectId: string, bucket: string, body: UpdateObject): Promise<StorageObject> {
    const f = (await this.storage(h.profile.id, projectId)).bucket(bucket).file(body.name);
    const patch: Any = {};
    for (const k of [
      'contentType',
      'cacheControl',
      'contentDisposition',
      'contentEncoding',
      'contentLanguage',
      'eventBasedHold',
      'temporaryHold',
    ] as const)
      if (body[k] !== undefined) patch[k] = body[k];
    if (body.metadata) {
      const [current] = await f.getMetadata();
      const next: Record<string, string | null> = { ...body.metadata };
      for (const k of Object.keys(current.metadata ?? {})) if (!(k in body.metadata)) next[k] = null;
      patch.metadata = next;
    }
    const [m] = await f.setMetadata(patch);
    this.record(h, projectId, 'storage.object.update', `${bucket}/${body.name}`, `Update ${body.name}`, bucket);
    return mapObject(m);
  }

  async deleteObjects(
    h: ProfileHandle,
    projectId: string,
    bucket: string,
    refs: ObjectRef[],
  ): Promise<{ deleted: number; failures: { name: string; error: string }[] }> {
    const s = await this.storage(h.profile.id, projectId);
    const failures: { name: string; error: string }[] = [];
    let deleted = 0;
    for (let i = 0; i < refs.length; i += DELETE_CONCURRENCY) {
      await Promise.all(
        refs.slice(i, i + DELETE_CONCURRENCY).map(async (r) => {
          try {
            await this.file(s, bucket, r).delete();
            deleted++;
          } catch (err) {
            failures.push({ name: r.name, error: toProblem(err).detail });
          }
        }),
      );
    }
    this.record(
      h,
      projectId,
      'storage.object.delete',
      bucket,
      `Delete ${deleted} ${deleted === 1 ? 'object' : 'objects'} from ${bucket}`,
      bucket,
    );
    return { deleted, failures };
  }

  async copyObject(h: ProfileHandle, projectId: string, bucket: string, body: CopyObject): Promise<StorageObject> {
    const s = await this.storage(h.profile.id, projectId);
    const source = this.file(s, bucket, body.source);
    const dest = s.bucket(body.destinationBucket).file(body.destinationName);
    const [copied] = await source.copy(dest);
    if (body.move) await source.delete();
    const [m] = await copied.getMetadata();
    this.record(
      h,
      projectId,
      body.move ? 'storage.object.move' : 'storage.object.copy',
      `${bucket}/${body.source.name}`,
      `${body.move ? 'Move' : 'Copy'} ${body.source.name} to ${body.destinationBucket}/${body.destinationName}`,
      body.destinationBucket,
    );
    return mapObject(m);
  }

  async restoreObject(h: ProfileHandle, projectId: string, bucket: string, name: string, generation: string): Promise<StorageObject> {
    const s = await this.storage(h.profile.id, projectId);
    const [restored] = await s.bucket(bucket).file(name).restore({ generation });
    this.record(h, projectId, 'storage.object.restore', `${bucket}/${name}`, `Restore ${name}`, bucket);
    return mapObject(restored.metadata ?? restored);
  }

  async makePublic(h: ProfileHandle, projectId: string, bucket: string, name: string): Promise<void> {
    const b = await this.bucket(h, projectId, bucket);
    if (b.publicAccessPrevention === 'enforced')
      throw ProblemException.of('FAILED_PRECONDITION', 'Public access prevention is enforced on this bucket.');
    if (b.uniformAccess)
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        'The bucket uses uniform access: grant allUsers the Storage Object Viewer role on the bucket instead.',
      );
    await (await this.storage(h.profile.id, projectId)).bucket(bucket).file(name).makePublic();
    this.record(h, projectId, 'storage.object.makePublic', `${bucket}/${name}`, `Make ${name} public`, bucket);
  }

  async signedUrl(
    h: ProfileHandle,
    projectId: string,
    bucket: string,
    name: string,
    expiresSeconds: number,
  ): Promise<{ url: string; expiresAt: string }> {
    if (!this.capabilities(h).canSign)
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        'This profile cannot sign URLs: it needs a service account key, or iam.serviceAccounts.signBlob on a service account.',
      );
    const expires = Date.now() + expiresSeconds * 1000;
    const [url] = await (await this.storage(h.profile.id, projectId))
      .bucket(bucket)
      .file(name)
      .getSignedUrl({ version: 'v4', action: 'read', expires });
    this.record(h, projectId, 'storage.object.signedUrl', `${bucket}/${name}`, `Sign a URL for ${name}`, bucket);
    return { url, expiresAt: new Date(expires).toISOString() };
  }

  /** A folder: a zero-byte "name/" object in flat buckets, a real folder with hierarchical namespace. */
  async createFolder(h: ProfileHandle, projectId: string, bucket: string, name: string, hierarchical: boolean): Promise<void> {
    if (hierarchical) {
      const control = await this.control(h.profile.id, 'Folders');
      await control.createFolder({ parent: `projects/_/buckets/${bucket}`, folderId: name, recursive: true });
    } else {
      await (await this.storage(h.profile.id, projectId))
        .bucket(bucket)
        .file(name)
        .save('', { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    }
    this.record(h, projectId, 'storage.folder.create', `${bucket}/${name}`, `Create folder ${name}`, bucket);
  }

  /** Renaming a folder is one operation in hierarchical buckets (D-11). */
  async renameFolder(h: ProfileHandle, projectId: string, bucket: string, source: string, destination: string): Promise<OperationSummary> {
    const control = await this.control(h.profile.id, 'Renaming folders');
    const [op] = await control.renameFolder({ name: `projects/_/buckets/${bucket}/folders/${source}`, destinationFolderId: destination });
    return this.operations.track({
      profileId: h.profile.id,
      projectId,
      product: 'storage',
      kind: 'storage.folder.rename',
      family: 'longrunning',
      resource: {
        name: `${bucket}/${source}`,
        displayName: `Rename ${source} to ${destination}`,
        href: `/p/${projectId}/storage/${encodeURIComponent(bucket)}`,
      },
      googleName: String(op.name),
      poll: lroPoller(operationGetter(control), String(op.name)),
    });
  }

  /**
   * Streams a request body into a resumable upload (D-11): nothing is held in memory. Without
   * overwrite, the upload only succeeds when the object does not exist yet.
   */
  async upload(
    h: ProfileHandle,
    projectId: string,
    bucket: string,
    name: string,
    contentType: string | undefined,
    overwrite: boolean,
    body: Readable,
  ): Promise<StorageObject> {
    const f = (await this.storage(h.profile.id, projectId)).bucket(bucket).file(name);
    const write = f.createWriteStream({
      resumable: true,
      ...(contentType ? { metadata: { contentType } } : {}),
      ...(overwrite ? {} : { preconditionOpts: { ifGenerationMatch: 0 } }),
    });
    try {
      await pipeline(body, write);
    } catch (err) {
      const p = toProblem(err);
      if ((err as { code?: unknown }).code === 412 || p.status === 412 || p.code === 'FAILED_PRECONDITION')
        throw ProblemException.of('ALREADY_EXISTS', `${name} already exists. Confirm to overwrite it.`, { reason: 'OBJECT_EXISTS' });
      throw err;
    }
    // fake-gcs-server drops the metadata of resumable uploads; Cloud Storage keeps it.
    const [m] = this.emulator && contentType ? await f.setMetadata({ contentType }) : await f.getMetadata();
    this.record(h, projectId, 'storage.object.upload', `${bucket}/${name}`, `Upload ${name}`, bucket);
    return mapObject(m);
  }
}
