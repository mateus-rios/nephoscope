import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  DatabaseIdSchema,
  type DatastoreEntity,
  type DeleteEntity,
  DeleteEntitySchema,
  type EntitiesPage,
  type GqlQuery,
  GqlQuerySchema,
  ProjectIdParamSchema,
  type SaveEntity,
  SaveEntitySchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { entityFromProto, entityToProto, keyFromProto, keyToProto, keyToString } from './datastore-codec.js';

// biome-ignore lint/suspicious/noExplicitAny: generated clients are loosely typed at this boundary.
type Any = any;

const PAGE = 50;
const QUERY_TTL_MS = 10 * 60 * 1000;

function datastoreGax(): Any {
  const here = createRequire(import.meta.url);
  return createRequire(here.resolve('@google-cloud/datastore'))('google-gax');
}

/** Datastore mode databases (SPEC-0004 D-13), through the low-level client so types stay exact. */
@Injectable()
export class DatastoreService {
  /** Parsed GQL queries by page token: the next page reuses Google's parsed form with the end cursor. */
  private readonly parsed = new Map<string, { query: Any; namespace: string; expires: number }>();

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
  ) {}

  private async client(profileId: string): Promise<{ client: Any }> {
    const { v1 } = await sdk.datastore();
    const host = this.config.emulators.datastore;
    if (host) {
      const url = new URL(`http://${host}`);
      return {
        client: this.clients.get(profileId, `datastore:${host}`, () => {
          const gax = datastoreGax();
          return new v1.DatastoreClient(
            { servicePath: url.hostname, port: Number(url.port || 8081), sslCreds: gax.grpc.credentials.createInsecure() },
            gax,
          );
        }),
      };
    }
    return { client: this.clients.get(profileId, 'datastore', (auth) => new v1.DatastoreClient({ auth: auth as never })) };
  }

  private partition(projectId: string, databaseId: string, namespace: string) {
    return { projectId, databaseId: databaseId === '(default)' ? '' : databaseId, namespaceId: namespace };
  }

  private async run(h: ProfileHandle, projectId: string, databaseId: string, request: Any): Promise<Any> {
    const { client } = await this.client(h.profile.id);
    const [res] = await client.runQuery({ projectId, databaseId: databaseId === '(default)' ? '' : databaseId, ...request });
    return res;
  }

  async namespaces(h: ProfileHandle, projectId: string, databaseId: string): Promise<string[]> {
    const res = await this.run(h, projectId, databaseId, {
      partitionId: this.partition(projectId, databaseId, ''),
      query: { kind: [{ name: '__namespace__' }], projection: [{ property: { name: '__key__' } }] },
    });
    const names = (res.batch?.entityResults ?? []).map((r: Any) => {
      const p = r.entity?.key?.path?.[0];
      return p?.name ? String(p.name) : '';
    });
    return [...new Set<string>(['', ...names])].sort();
  }

  async kinds(h: ProfileHandle, projectId: string, databaseId: string, namespace: string): Promise<string[]> {
    const res = await this.run(h, projectId, databaseId, {
      partitionId: this.partition(projectId, databaseId, namespace),
      query: { kind: [{ name: '__kind__' }], projection: [{ property: { name: '__key__' } }] },
    });
    return (res.batch?.entityResults ?? [])
      .map((r: Any) => String(r.entity?.key?.path?.[0]?.name ?? ''))
      .filter((k: string) => k && !k.startsWith('__'))
      .sort();
  }

  private page(res: Any, token: string | null): EntitiesPage {
    const more = res.batch?.moreResults;
    const endCursor = res.batch?.endCursor ? Buffer.from(res.batch.endCursor).toString('base64') : null;
    return {
      items: (res.batch?.entityResults ?? []).map((r: Any) => entityFromProto(r.entity)),
      endCursor:
        more === 'NOT_FINISHED' || more === 'MORE_RESULTS_AFTER_LIMIT' || more === 'MORE_RESULTS_AFTER_CURSOR'
          ? token && endCursor
            ? `${token}.${endCursor}`
            : endCursor
          : null,
      moreResults: more !== 'NO_MORE_RESULTS',
    };
  }

  async entities(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    namespace: string,
    kind: string,
    cursor?: string,
  ): Promise<EntitiesPage> {
    const res = await this.run(h, projectId, databaseId, {
      partitionId: this.partition(projectId, databaseId, namespace),
      query: { kind: [{ name: kind }], limit: { value: PAGE }, ...(cursor ? { startCursor: Buffer.from(cursor, 'base64') } : {}) },
    });
    return this.page(res, null);
  }

  /** GQL with literals allowed; the next page runs Google's parsed query from the end cursor. */
  async gql(h: ProfileHandle, projectId: string, databaseId: string, body: GqlQuery & { namespace: string }): Promise<EntitiesPage> {
    const now = Date.now();
    for (const [k, v] of this.parsed) if (v.expires < now) this.parsed.delete(k);
    const partitionId = this.partition(projectId, databaseId, body.namespace);
    if (body.cursor) {
      const [token, cursor] = body.cursor.split('.');
      const saved = token ? this.parsed.get(token) : undefined;
      if (!saved || !cursor) throw ProblemException.of('FAILED_PRECONDITION', 'This page of results expired. Run the query again.');
      const res = await this.run(h, projectId, databaseId, {
        partitionId,
        query: { ...saved.query, startCursor: Buffer.from(cursor, 'base64') },
      });
      saved.expires = now + QUERY_TTL_MS;
      return this.page(res, token ?? null);
    }
    const res = await this.run(h, projectId, databaseId, { partitionId, gqlQuery: { queryString: body.gql, allowLiterals: true } });
    const token = randomUUID().slice(0, 8);
    if (res.query) this.parsed.set(token, { query: res.query, namespace: body.namespace, expires: now + QUERY_TTL_MS });
    return this.page(res, res.query ? token : null);
  }

  async lookup(h: ProfileHandle, projectId: string, databaseId: string, key: DatastoreEntity['key']): Promise<DatastoreEntity> {
    const { client } = await this.client(h.profile.id);
    const [res] = await client.lookup({
      projectId,
      databaseId: databaseId === '(default)' ? '' : databaseId,
      keys: [keyToProto(key, projectId, databaseId)],
    });
    const found = res.found?.[0]?.entity;
    if (!found) throw ProblemException.of('NOT_FOUND', `${keyToString(key)} does not exist.`);
    return entityFromProto(found);
  }

  async save(h: ProfileHandle, projectId: string, databaseId: string, body: SaveEntity): Promise<DatastoreEntity> {
    const { client } = await this.client(h.profile.id);
    const entity: DatastoreEntity = {
      key: { namespace: body.key.namespace ?? '', path: body.key.path },
      properties: body.properties as DatastoreEntity['properties'],
    };
    const [res] = await client.commit({
      projectId,
      databaseId: databaseId === '(default)' ? '' : databaseId,
      mode: 'NON_TRANSACTIONAL',
      mutations: [{ upsert: entityToProto(entity, projectId, databaseId) }],
    });
    // A key without an id or name gets one allocated by the commit.
    const allocated = res.mutationResults?.[0]?.key;
    const key = allocated ? keyFromProto(allocated) : entity.key;
    this.record(h, projectId, 'datastore.entity.upsert', `Save ${keyToString(key)}`);
    return this.lookup(h, projectId, databaseId, key);
  }

  async remove(h: ProfileHandle, projectId: string, databaseId: string, key: DatastoreEntity['key']): Promise<void> {
    const { client } = await this.client(h.profile.id);
    await client.commit({
      projectId,
      databaseId: databaseId === '(default)' ? '' : databaseId,
      mode: 'NON_TRANSACTIONAL',
      mutations: [{ delete: keyToProto(key, projectId, databaseId) }],
    });
    this.record(h, projectId, 'datastore.entity.delete', `Delete ${keyToString(key)}`);
  }

  private record(h: ProfileHandle, projectId: string, kind: string, displayName: string) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind,
      resource: { name: displayName, displayName, href: null },
    });
  }
}

const p = { schema: ProjectIdParamSchema };
const d = { schema: DatabaseIdSchema };
const DB = 'projects/:projectId/databases/:database';

@Controller('api/projects/:projectId/datastore/databases/:database')
export class DatastoreController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly datastore: DatastoreService,
  ) {}

  @Get('namespaces')
  namespaces(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
  ): Promise<string[]> {
    return this.datastore.namespaces(this.profiles.get(profileId), projectId, database);
  }

  @Get('kinds')
  kinds(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({ schema: z.object({ namespace: z.string().max(100).default('') }) }) q: { namespace: string },
  ): Promise<string[]> {
    return this.datastore.kinds(this.profiles.get(profileId), projectId, database, q.namespace);
  }

  @Get('entities')
  entities(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({
      schema: z.object({
        namespace: z.string().max(100).default(''),
        kind: z.string().min(1).max(1500),
        cursor: z.string().max(4096).optional(),
      }),
    })
    q: { namespace: string; kind: string; cursor?: string },
  ): Promise<EntitiesPage> {
    return this.datastore.entities(this.profiles.get(profileId), projectId, database, q.namespace, q.kind, q.cursor);
  }

  @Post('gql')
  @HttpCode(200)
  gql(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: GqlQuerySchema }) body: GqlQuery & { namespace: string },
  ): Promise<EntitiesPage> {
    return this.datastore.gql(this.profiles.get(profileId), projectId, database, body);
  }

  @Put('entity')
  @Mutation({ product: 'firestore', verb: 'datastore.entity.upsert', resource: DB })
  save(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: SaveEntitySchema }) body: SaveEntity,
  ): Promise<DatastoreEntity> {
    return this.datastore.save(this.profiles.get(profileId), projectId, database, body);
  }

  @Post('entity/delete')
  @HttpCode(204)
  @Mutation({ product: 'firestore', verb: 'datastore.entity.delete', resource: DB })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: DeleteEntitySchema }) body: DeleteEntity & { key: DatastoreEntity['key'] },
  ): Promise<void> {
    const last = body.key.path.at(-1);
    requireConfirmation(body.confirm, last?.name ?? last?.id ?? '');
    await this.datastore.remove(this.profiles.get(profileId), projectId, database, body.key);
  }
}

/** Datastore mode (SPEC-0004 D-13, CA-20). */
@Module({ controllers: [DatastoreController], providers: [DatastoreService] })
export class DatastoreModule {}
