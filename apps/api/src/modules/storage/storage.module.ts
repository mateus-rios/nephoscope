import { pipeline } from 'node:stream/promises';
import {
  type BucketIamPolicy,
  BucketNameSchema,
  type CopyObject,
  CopyObjectSchema,
  type CreateBucket,
  CreateBucketSchema,
  type DeleteBucket,
  DeleteBucketSchema,
  type DeleteObjects,
  DeleteObjectsSchema,
  FolderSchema,
  ListObjectsQuerySchema,
  type ListResponse,
  LockRetentionSchema,
  type ObjectLink,
  type ObjectLinkRequest,
  ObjectLinkSchema,
  type ObjectsPage,
  type OperationAccepted,
  type OperationSummary,
  ProjectIdParamSchema,
  RenameFolderSchema,
  RestoreObjectSchema,
  type SetBucketIam,
  SetBucketIamSchema,
  SignedUrlSchema,
  type StorageBucket,
  type StorageCapabilities,
  type StorageObject,
  servedType,
  type UpdateBucket,
  UpdateBucketSchema,
  type UpdateObject,
  UpdateObjectSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, Head, HttpCode, Module, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { ObjectLinks } from './object-links.js';
import { StorageService } from './storage.service.js';
import { contentDisposition, parseRange } from './storage-mapping.js';

const p = { schema: ProjectIdParamSchema };
const b = { schema: BucketNameSchema };
const BUCKET = 'projects/:projectId/buckets/:bucket';
const objectQuery = { schema: z.object({ name: z.string().min(1).max(1024), generation: z.string().regex(/^\d+$/).optional() }) };
const baseName = (name: string) => name.replace(/\/$/, '').split('/').pop() ?? name;

@Controller('api/projects/:projectId/storage')
export class StorageController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly storage: StorageService,
    private readonly links: ObjectLinks,
  ) {}

  @Get('capabilities')
  capabilities(@ProfileId() profileId: string | undefined): StorageCapabilities {
    return this.storage.capabilities(this.profiles.get(profileId));
  }

  // ---- buckets -----------------------------------------------------------------------------------

  @Get('buckets')
  buckets(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<StorageBucket>> {
    return this.storage.buckets(this.profiles.get(profileId), projectId);
  }

  @Post('buckets')
  @Mutation({ product: 'storage', verb: 'bucket.create', resource: 'projects/:projectId/buckets' })
  createBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateBucketSchema }) body: CreateBucket,
  ): Promise<StorageBucket> {
    return this.storage.createBucket(this.profiles.get(profileId), projectId, body);
  }

  @Get('buckets/:bucket')
  bucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
  ): Promise<StorageBucket> {
    return this.storage.bucket(this.profiles.get(profileId), projectId, bucket);
  }

  @Get('buckets/:bucket/raw')
  bucketRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
  ): Promise<unknown> {
    return this.storage.bucketRaw(this.profiles.get(profileId), projectId, bucket);
  }

  @Patch('buckets/:bucket')
  @Mutation({ product: 'storage', verb: 'bucket.update', resource: BUCKET })
  updateBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: UpdateBucketSchema }) body: UpdateBucket,
  ): Promise<StorageBucket> {
    return this.storage.updateBucket(this.profiles.get(profileId), projectId, bucket, body);
  }

  /** Locking is irreversible (D-10): the typed bucket name is required. */
  @Post('buckets/:bucket/lock-retention')
  @HttpCode(200)
  @Mutation({ product: 'storage', verb: 'bucket.lockRetention', resource: BUCKET })
  lockRetention(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: LockRetentionSchema }) body: { metageneration: string; confirm: string },
  ): Promise<StorageBucket> {
    requireConfirmation(body.confirm, bucket);
    return this.storage.lockRetention(this.profiles.get(profileId), projectId, bucket, body.metageneration);
  }

  @Get('buckets/:bucket/count')
  count(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
  ): Promise<{ count: number; capped: boolean }> {
    return this.storage.countObjects(this.profiles.get(profileId), projectId, bucket);
  }

  @Delete('buckets/:bucket')
  @Mutation({ product: 'storage', verb: 'bucket.delete', resource: BUCKET })
  async deleteBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: DeleteBucketSchema }) body: DeleteBucket,
  ): Promise<OperationAccepted | { operation: null }> {
    requireConfirmation(body.confirm, bucket);
    const op: OperationSummary | null = await this.storage.deleteBucket(
      this.profiles.get(profileId),
      projectId,
      bucket,
      body.confirmObjects,
    );
    return { operation: op } as OperationAccepted | { operation: null };
  }

  @Get('buckets/:bucket/iam')
  iam(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
  ): Promise<BucketIamPolicy> {
    return this.storage.iam(this.profiles.get(profileId), projectId, bucket);
  }

  @Put('buckets/:bucket/iam')
  @Mutation({ product: 'storage', verb: 'bucket.setIam', resource: BUCKET })
  setIam(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: SetBucketIamSchema }) body: SetBucketIam,
  ): Promise<BucketIamPolicy> {
    return this.storage.setIam(this.profiles.get(profileId), projectId, bucket, body);
  }

  // ---- objects ---------------------------------------------------------------------------------------

  @Get('buckets/:bucket/objects')
  async objects(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Query({ schema: ListObjectsQuerySchema }) q: z.infer<typeof ListObjectsQuerySchema>,
    @Query({ schema: z.object({ hierarchical: z.enum(['true', 'false']).optional() }) }) extra: { hierarchical?: string },
  ): Promise<ObjectsPage> {
    return this.storage.objects(this.profiles.get(profileId), projectId, bucket, q, extra.hierarchical === 'true');
  }

  @Get('buckets/:bucket/object')
  object(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Query(objectQuery) q: { name: string; generation?: string },
  ): Promise<StorageObject> {
    return this.storage.object(this.profiles.get(profileId), projectId, bucket, q);
  }

  @Patch('buckets/:bucket/object')
  @Mutation({ product: 'storage', verb: 'object.update', resource: BUCKET })
  updateObject(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: UpdateObjectSchema }) body: UpdateObject,
  ): Promise<StorageObject> {
    return this.storage.updateObject(this.profiles.get(profileId), projectId, bucket, body);
  }

  /** One object needs its name typed; several need the count (D-11). */
  @Post('buckets/:bucket/objects/delete')
  @HttpCode(200)
  @Mutation({ product: 'storage', verb: 'object.delete', resource: BUCKET })
  deleteObjects(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: DeleteObjectsSchema }) body: DeleteObjects,
  ): Promise<{ deleted: number; failures: { name: string; error: string }[] }> {
    const only = body.objects[0];
    requireConfirmation(body.confirm, body.objects.length === 1 && only ? baseName(only.name) : String(body.objects.length));
    return this.storage.deleteObjects(this.profiles.get(profileId), projectId, bucket, body.objects);
  }

  @Post('buckets/:bucket/objects/copy')
  @Mutation({ product: 'storage', verb: 'object.copy', resource: BUCKET })
  copy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: CopyObjectSchema }) body: CopyObject & z.infer<typeof CopyObjectSchema>,
  ): Promise<StorageObject> {
    return this.storage.copyObject(this.profiles.get(profileId), projectId, bucket, body);
  }

  @Post('buckets/:bucket/objects/restore')
  @Mutation({ product: 'storage', verb: 'object.restore', resource: BUCKET })
  restore(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: RestoreObjectSchema }) body: { name: string; generation: string },
  ): Promise<StorageObject> {
    return this.storage.restoreObject(this.profiles.get(profileId), projectId, bucket, body.name, body.generation);
  }

  @Post('buckets/:bucket/objects/public')
  @HttpCode(204)
  @Mutation({ product: 'storage', verb: 'object.makePublic', resource: BUCKET })
  async makePublic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: z.object({ name: z.string().min(1).max(1024), confirm: z.string().min(1) }) }) body: { name: string; confirm: string },
  ): Promise<void> {
    requireConfirmation(body.confirm, baseName(body.name));
    await this.storage.makePublic(this.profiles.get(profileId), projectId, bucket, body.name);
  }

  @Post('buckets/:bucket/objects/signed-url')
  @HttpCode(200)
  @Mutation({ product: 'storage', verb: 'object.signedUrl', resource: BUCKET, scope: 'reveal' })
  signedUrl(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: SignedUrlSchema }) body: { name: string; expiresSeconds: number },
  ): Promise<{ url: string; expiresAt: string }> {
    return this.storage.signedUrl(this.profiles.get(profileId), projectId, bucket, body.name, body.expiresSeconds);
  }

  /** A short-lived streaming link for previews and downloads (D-11, D-12). */
  @Post('buckets/:bucket/objects/link')
  @HttpCode(200)
  async link(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: ObjectLinkSchema }) body: ObjectLinkRequest,
  ): Promise<ObjectLink> {
    const h = this.profiles.get(profileId);
    const o = await this.storage.object(h, projectId, bucket, body);
    return this.links.create(h.profile.id, projectId, bucket, body, o.contentType);
  }

  @Post('buckets/:bucket/folders')
  @HttpCode(204)
  @Mutation({ product: 'storage', verb: 'folder.create', resource: BUCKET })
  async createFolder(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: FolderSchema.extend({ hierarchical: z.boolean().default(false) }) }) body: { name: string; hierarchical: boolean },
  ): Promise<void> {
    await this.storage.createFolder(this.profiles.get(profileId), projectId, bucket, body.name, body.hierarchical);
  }

  @Post('buckets/:bucket/folders/rename')
  @Mutation({ product: 'storage', verb: 'folder.rename', resource: BUCKET })
  async renameFolder(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Body({ schema: RenameFolderSchema }) body: { source: string; destination: string },
  ): Promise<OperationAccepted> {
    return { operation: await this.storage.renameFolder(this.profiles.get(profileId), projectId, bucket, body.source, body.destination) };
  }

  /** The request body is the file, streamed straight into a resumable upload (CA-11). */
  @Put('buckets/:bucket/upload')
  @Mutation({ product: 'storage', verb: 'object.upload', resource: BUCKET })
  upload(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('bucket', b) bucket: string,
    @Query({ schema: z.object({ name: z.string().min(1).max(1024), overwrite: z.enum(['true', 'false']).default('false') }) }) q: {
      name: string;
      overwrite: string;
    },
    @Req() req: Request,
  ): Promise<StorageObject> {
    const type = req.headers['content-type'];
    return this.storage.upload(
      this.profiles.get(profileId),
      projectId,
      bucket,
      q.name,
      type && type !== 'application/octet-stream' ? type : undefined,
      q.overwrite === 'true',
      req,
    );
  }
}

/**
 * Streams an object through a link (D-11, D-12, SPEC-0001 CA-73): byte ranges for media, never
 * in memory, inline only for the safe types and with its own restrictive policy.
 */
@Controller('api/o')
export class ObjectStreamController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly storage: StorageService,
    private readonly links: ObjectLinks,
  ) {}

  @Get(':token')
  get(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    return this.stream(token, req, res, false);
  }

  @Head(':token')
  head(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    return this.stream(token, req, res, true);
  }

  private async stream(token: string, req: Request, res: Response, headOnly: boolean): Promise<void> {
    try {
      const link = this.links.get(token);
      if (!link) throw ProblemException.of('NOT_FOUND', 'This link expired. Open the object again.');
      const h = this.profiles.get(link.profileId);
      const s = await this.storage.storage(h.profile.id, link.projectId);
      const file = s.bucket(link.bucket).file(link.name, link.generation ? { generation: link.generation } : {});
      const [m] = await file.getMetadata();
      const size = Number(m.size ?? 0);
      const range = parseRange(req.headers.range, size);
      if (range === 'invalid') {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');
      // HTML, SVG and XML stay attachments even as source (SPEC-0001 CA-73): the page reads them with fetch, which ignores it.
      const inline = !!link.kind && link.kind !== 'source';
      res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', link.name));
      // Raster images and media keep a media type; anything else inline is plain text, the rest bytes.
      res.setHeader('Content-Type', link.kind ? servedType(link.kind, m.contentType, link.name) : 'application/octet-stream');
      // Frames of this page may show a PDF (the viewer cannot run sandboxed); nothing here runs script.
      res.setHeader(
        'Content-Security-Policy',
        link.kind === 'pdf' ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; sandbox; frame-ancestors 'self'",
      );
      if (range) {
        res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
      } else {
        res.status(200).setHeader('Content-Length', String(size));
      }
      if (headOnly || size === 0) {
        res.end();
        return;
      }
      const read = file.createReadStream({
        ...(range ? { start: range.start, end: range.end } : {}),
        validation: range ? false : 'crc32c',
        decompress: false,
      });
      await pipeline(read, res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const problem = toProblem(err);
      res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
    }
  }
}

/** Cloud Storage (SPEC-0006 §7.2). */
@Module({ controllers: [StorageController, ObjectStreamController], providers: [StorageService, ObjectLinks], exports: [StorageService] })
export class StorageModule {}
