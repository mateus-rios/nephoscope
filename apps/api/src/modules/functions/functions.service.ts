import type {
  CloudFunction,
  FunctionSource,
  FunctionSummary,
  InvokeRequest,
  InvokeResponse,
  ListResponse,
  OperationSummary,
  RedeploySource,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { lroPoller, type OperationLike, operationGetter } from '../../core/gcp/lro.js';
import { rawJson } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { InvokeService } from '../../core/invoke/invoke.service.js';
import { OperationsService, type Poller } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { RunService } from '../run/run.service.js';
import { mapFunction, mapFunctionSummary, mergeFunctions } from './functions-mapping.js';
import { fetchArchive, patchArchive, readArchive } from './source-archive.js';

// biome-ignore lint/suspicious/noExplicitAny: generated messages are passed through.
type Any = any;

const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const shortName = (name: string) => name.split('/').pop() ?? name;
const href = (name: string) => `/p/${projectOf(name)}/functions/${locationOf(name)}/${shortName(name)}`;

type Kind = 'functions.function.redeploy' | 'functions.function.delete' | 'functions.gen1.delete';

/** Cloud Run functions (SPEC-0003 D-07 to D-09, CA-14 to CA-17). */
@Injectable()
export class FunctionsService {
  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
    private readonly invoker: InvokeService,
    private readonly run: RunService,
  ) {
    for (const kind of ['functions.function.redeploy', 'functions.function.delete', 'functions.gen1.delete'] as const) {
      this.operations.registerResumer(kind, (op) => (op.googleName ? this.poller(op.profileId, kind, op.googleName) : null));
    }
  }

  private async v2(profileId: string) {
    const { v2 } = await sdk.functions();
    return this.clients.get(profileId, 'functions.v2', (auth) => new v2.FunctionServiceClient({ auth }));
  }

  private async v1(profileId: string) {
    const { v1 } = await sdk.functions();
    return this.clients.get(profileId, 'functions.v1', (auth) => new v1.CloudFunctionsServiceClient({ auth }));
  }

  private poller(profileId: string, kind: Kind, googleName: string): Poller {
    return lroPoller(async (name) => {
      const client = kind === 'functions.gen1.delete' ? await this.v1(profileId) : await this.v2(profileId);
      return operationGetter(client as never)(name);
    }, googleName);
  }

  private track(h: ProfileHandle, kind: Kind, name: string, displayName: string, op: OperationLike): OperationSummary {
    const googleName = op.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'functions',
      kind,
      family: 'longrunning',
      googleName,
      resource: { name, displayName, href: href(name) },
      poll: googleName ? this.poller(h.profile.id, kind, googleName) : async () => ({ done: true }),
    });
  }

  /** The merged list of SPEC-0003 D-07. A failing Cloud Run list only drops the second source. */
  async list(h: ProfileHandle, projectId: string): Promise<ListResponse<FunctionSummary>> {
    const client = await this.v2(h.profile.id);
    const [functionsResult, runResult] = await Promise.allSettled([
      client.listFunctions({ parent: `projects/${projectId}/locations/-`, pageSize: 1000 }, { autoPaginate: false }),
      this.run.listServices(h, projectId, 1000),
    ]);
    if (functionsResult.status === 'rejected') throw functionsResult.reason;
    const [items, , response] = functionsResult.value;
    const api = items.map(mapFunctionSummary);
    const run = runResult.status === 'fulfilled' ? runResult.value.items : [];
    const unreachable = [
      ...((response as Any)?.unreachable ?? []),
      ...(runResult.status === 'fulfilled' ? (runResult.value.unreachable ?? []) : ['Cloud Run']),
    ];
    return { items: mergeFunctions(api, run), nextPageToken: null, unreachable: [...new Set(unreachable)] };
  }

  private async raw(h: ProfileHandle, name: string): Promise<Any> {
    const [f] = await (await this.v2(h.profile.id)).getFunction({ name });
    return f;
  }

  async get(h: ProfileHandle, name: string): Promise<CloudFunction> {
    return mapFunction(await this.raw(h, name));
  }

  async rawJson(h: ProfileHandle, name: string): Promise<unknown> {
    return rawJson(await this.raw(h, name));
  }

  private async archive(h: ProfileHandle, fn: CloudFunction): Promise<Uint8Array> {
    const [res] =
      fn.generation === 'gen1'
        ? await (await this.v1(h.profile.id)).generateDownloadUrl({ name: fn.name })
        : await (await this.v2(h.profile.id)).generateDownloadUrl({ name: fn.name });
    if (!res.downloadUrl) throw ProblemException.of('FAILED_PRECONDITION', 'Google returned no download URL for this function source.');
    return fetchArchive(res.downloadUrl);
  }

  async source(h: ProfileHandle, name: string): Promise<FunctionSource> {
    return readArchive(await this.archive(h, await this.get(h, name)));
  }

  async sourceArchive(h: ProfileHandle, name: string): Promise<Uint8Array> {
    return this.archive(h, await this.get(h, name));
  }

  /** Edit and redeploy gen2 source (SPEC-0003 D-09): new zip, upload URL, updateFunction. */
  async redeploy(h: ProfileHandle, name: string, patch: RedeploySource): Promise<OperationSummary> {
    const fn = await this.get(h, name);
    if (!fn.sourceEditable) {
      throw ProblemException.of('FAILED_PRECONDITION', 'Only gen2 functions deployed from an uploaded archive can be edited here.');
    }
    const zip = patchArchive(await this.archive(h, fn), patch);
    const client = await this.v2(h.profile.id);
    const [upload] = await client.generateUploadUrl({
      parent: `projects/${projectOf(name)}/locations/${locationOf(name)}`,
      environment: 'GEN_2',
    });
    if (!upload.uploadUrl || !upload.storageSource) throw ProblemException.of('FAILED_PRECONDITION', 'Google returned no upload URL.');
    // The signed URL carries its own authorization; an Authorization header would be rejected.
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip' },
      body: zip,
      signal: AbortSignal.timeout(300_000),
    });
    if (!put.ok) throw ProblemException.of('UNAVAILABLE', `Uploading the new source failed (HTTP ${put.status}).`, { retryable: true });
    const [op] = await client.updateFunction({
      function: { name, buildConfig: { source: { storageSource: upload.storageSource } } },
      updateMask: { paths: ['build_config.source'] },
    });
    return this.track(h, 'functions.function.redeploy', name, `Redeploy ${shortName(name)}`, op);
  }

  async remove(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const fn = await this.get(h, name);
    // The v2 API only reads gen1 functions; deleting one goes through v1 (SPEC-0003 D-09).
    const [op] =
      fn.generation === 'gen1'
        ? await (await this.v1(h.profile.id)).deleteFunction({ name })
        : await (await this.v2(h.profile.id)).deleteFunction({ name });
    return this.track(h, fn.generation === 'gen1' ? 'functions.gen1.delete' : 'functions.function.delete', name, `Delete ${fn.id}`, op);
  }

  async invoke(h: ProfileHandle, name: string, req: InvokeRequest): Promise<InvokeResponse> {
    const fn = await this.get(h, name);
    if (fn.trigger.kind !== 'http' || !fn.url) {
      throw ProblemException.of('FAILED_PRECONDITION', 'This function is triggered by events. Publish an event to its source to test it.');
    }
    if (req.tag) throw ProblemException.of('INVALID_ARGUMENT', 'Functions have no tagged URLs.');
    return this.invoker.invoke(h, fn.url, req);
  }
}
