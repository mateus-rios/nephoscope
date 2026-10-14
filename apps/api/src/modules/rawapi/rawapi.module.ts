import {
  discoveryJsonSchema,
  expandRawPath,
  ProjectIdParamSchema,
  RAW_HISTORY_LIMIT,
  RAW_SECRET_APIS,
  type RawApiEntry,
  RawApiNameSchema,
  type RawApiTree,
  RawApiVersionSchema,
  type RawCall,
  type RawCallResult,
  RawCallSchema,
  type RawHistoryItem,
  type RawMethodDetail,
  RawMethodIdSchema,
  type RawMethodSummary,
  type RawParam,
  type RawResourceNode,
  rawConfirmToken,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { isGoogleApiUrl, queryString, rest } from '../../core/gcp/rest.js';
import { ProblemException } from '../../core/problem/problem.js';
import { HistoryService } from '../../core/store/history.service.js';

// biome-ignore lint/suspicious/noExplicitAny: discovery documents are read field by field.
type Any = any;

const DIRECTORY = 'https://discovery.googleapis.com/discovery/v1/apis';
const TTL_MS = 60 * 60_000;
const MAX_DOCS = 30;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const HISTORY_KEY = 'rawapi.requests';
/** Response headers worth showing; cookies and transport details are left out. */
const SHOWN_HEADERS = /^(content-type|content-length|etag|location|date|x-goog-[a-z-]+|grpc-[a-z-]+|retry-after)$/;

const firstSentence = (s: unknown) => String(s ?? '').split(/(?<=\.)\s/)[0] ?? '';

function summary(m: Any): RawMethodSummary {
  return {
    id: String(m.id),
    httpMethod: String(m.httpMethod ?? 'GET'),
    path: String(m.path ?? ''),
    description: firstSentence(m.description),
  };
}

function resourceNode(name: string, r: Any): RawResourceNode {
  return {
    name,
    methods: Object.values((r?.methods ?? {}) as Record<string, Any>).map(summary),
    resources: Object.entries((r?.resources ?? {}) as Record<string, Any>).map(([n, child]) => resourceNode(n, child)),
  };
}

/** Finds a method by id anywhere in a discovery document. */
export function findMethod(doc: Any, methodId: string): Any | null {
  const scan = (node: Any): Any | null => {
    for (const m of Object.values((node?.methods ?? {}) as Record<string, Any>)) if (m?.id === methodId) return m;
    for (const r of Object.values((node?.resources ?? {}) as Record<string, Any>)) {
      const found = scan(r);
      if (found) return found;
    }
    return null;
  };
  return scan(doc);
}

export function baseUrlOf(doc: Any): string {
  return String(doc?.baseUrl ?? `${doc?.rootUrl ?? ''}${doc?.servicePath ?? ''}`);
}

export function methodDetail(doc: Any, m: Any): RawMethodDetail {
  const parameters: RawParam[] = Object.entries((m.parameters ?? {}) as Record<string, Any>).map(([name, p]) => ({
    name,
    location: p.location === 'path' ? 'path' : 'query',
    type: String(p.type ?? 'string'),
    required: !!p.required,
    repeated: !!p.repeated,
    description: String(p.description ?? ''),
    pattern: p.pattern ? String(p.pattern) : null,
    enum: Array.isArray(p.enum) ? p.enum.map(String) : [],
  }));
  const order = (m.parameterOrder ?? []) as string[];
  parameters.sort((a, b) => {
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name);
  });
  const requestRef = m.request?.$ref ? String(m.request.$ref) : null;
  return {
    ...summary(m),
    description: String(m.description ?? ''),
    baseUrl: baseUrlOf(doc),
    parameters,
    requestSchema: requestRef ? discoveryJsonSchema(doc.schemas ?? {}, requestRef) : null,
    requestRef,
    responseRef: m.response?.$ref ? String(m.response.$ref) : null,
    scopes: ((m.scopes ?? []) as Any[]).map(String),
  };
}

/** The raw API console (SPEC-0009 D-01): discovery, method forms, and calls with the app's guards. */
@Injectable()
export class RawApiService {
  private directory: { at: number; items: RawApiEntry[]; urls: Map<string, string> } | null = null;
  private readonly docs = new Map<string, { at: number; doc: Any }>();

  constructor(private readonly history: HistoryService) {}

  async list(h: ProfileHandle): Promise<RawApiEntry[]> {
    if (this.directory && Date.now() - this.directory.at < TTL_MS) return this.directory.items;
    const data = await rest(h, '').get<Any>(DIRECTORY);
    const urls = new Map<string, string>();
    const items: RawApiEntry[] = ((data?.items ?? []) as Any[]).map((i) => {
      urls.set(`${i.name}:${i.version}`, String(i.discoveryRestUrl ?? ''));
      return {
        id: `${i.name}:${i.version}`,
        name: String(i.name),
        version: String(i.version),
        title: String(i.title ?? i.name),
        description: String(i.description ?? ''),
        preferred: !!i.preferred,
      };
    });
    this.directory = { at: Date.now(), items, urls };
    return items;
  }

  /** A discovery document, fetched once and kept for an hour (R-02). */
  private async doc(h: ProfileHandle, name: string, version: string): Promise<Any> {
    const key = `${name}:${version}`;
    const hit = this.docs.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.doc;
    await this.list(h);
    const url = this.directory?.urls.get(key);
    if (!url) throw ProblemException.of('NOT_FOUND', `The discovery directory has no API ${key}.`);
    if (!isGoogleApiUrl(url))
      throw ProblemException.of('FAILED_PRECONDITION', `The discovery document of ${key} is not on a Google API host.`);
    const doc = await rest(h, '').get<Any>(url);
    this.docs.delete(key);
    this.docs.set(key, { at: Date.now(), doc });
    for (const old of [...this.docs.keys()].slice(0, Math.max(0, this.docs.size - MAX_DOCS))) this.docs.delete(old);
    return doc;
  }

  async tree(h: ProfileHandle, name: string, version: string): Promise<RawApiTree> {
    const doc = await this.doc(h, name, version);
    const root = resourceNode('', doc);
    return { name, version, title: String(doc.title ?? name), baseUrl: baseUrlOf(doc), methods: root.methods, resources: root.resources };
  }

  async method(h: ProfileHandle, name: string, version: string, methodId: string): Promise<RawMethodDetail> {
    const doc = await this.doc(h, name, version);
    const m = findMethod(doc, methodId);
    if (!m) throw ProblemException.of('NOT_FOUND', `${name} ${version} has no method ${methodId}.`);
    return methodDetail(doc, m);
  }

  /**
   * Sends a call the discovery document describes, with the profile's credentials. `read` takes
   * GET methods only; `write` takes the others, behind the read-only guard and the audit trail.
   */
  async call(h: ProfileHandle, b: RawCall, mode: 'read' | 'write'): Promise<RawCallResult> {
    const doc = await this.doc(h, b.api, b.version);
    const m = findMethod(doc, b.methodId);
    if (!m) throw ProblemException.of('NOT_FOUND', `${b.api} ${b.version} has no method ${b.methodId}.`);
    const httpMethod = String(m.httpMethod ?? 'GET').toUpperCase();
    if ((httpMethod === 'GET') !== (mode === 'read')) {
      throw ProblemException.of(
        'INVALID_ARGUMENT',
        `${b.methodId} is a ${httpMethod} method; send it as a ${httpMethod === 'GET' ? 'read' : 'write'}.`,
      );
    }
    const detail = methodDetail(doc, m);
    let path: string;
    try {
      path = expandRawPath(detail.path, b.params);
    } catch (err) {
      throw ProblemException.of('INVALID_ARGUMENT', (err as Error).message);
    }
    for (const p of detail.parameters) {
      if (p.required && p.location === 'query' && (b.params[p.name] === undefined || b.params[p.name] === ''))
        throw ProblemException.of('INVALID_ARGUMENT', `The parameter ${p.name} is required.`, {
          errors: [{ path: `params.${p.name}`, message: 'Required' }],
        });
    }
    if (httpMethod === 'DELETE') requireConfirmation(b.confirm, rawConfirmToken(path));
    // Only parameters the method declares reach Google.
    const query: Record<string, string | string[]> = {};
    for (const p of detail.parameters) {
      const v = b.params[p.name];
      if (p.location === 'query' && v !== undefined && v !== '') query[p.name] = v;
    }
    const url = `${detail.baseUrl}${path}${queryString(query)}`;
    if (!isGoogleApiUrl(url)) throw ProblemException.of('INVALID_ARGUMENT', 'Only Google API hosts can be called.');
    const hasBody = detail.requestRef !== null && b.body !== undefined;

    const client = await h.auth.getClient();
    const headers = new Headers((await client.getRequestHeaders(url)) as ConstructorParameters<typeof Headers>[0]);
    if (hasBody) headers.set('content-type', 'application/json');
    const started = performance.now();
    // A redirect is returned as it is, so the credentials never follow it to another host.
    const res = await fetch(url, { method: httpMethod, headers, body: hasBody ? JSON.stringify(b.body) : undefined, redirect: 'manual' });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.subarray(0, MAX_RESPONSE_BYTES).toString('utf8');
    let body: unknown = text;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (buf.length > MAX_RESPONSE_BYTES) body = `${text}\n… cut at ${MAX_RESPONSE_BYTES} bytes`;
    const shown: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) if (SHOWN_HEADERS.test(k)) shown[k] = v;

    const item: RawHistoryItem = {
      at: new Date().toISOString(),
      api: b.api,
      version: b.version,
      methodId: b.methodId,
      httpMethod,
      params: b.params,
      ...(hasBody && !RAW_SECRET_APIS.includes(b.api) ? { body: b.body } : {}),
      status: res.status,
    };
    await this.history.add(HISTORY_KEY, JSON.stringify(item), RAW_HISTORY_LIMIT);
    return {
      status: res.status,
      statusText: res.statusText,
      headers: shown,
      body,
      durationMs: Math.round(performance.now() - started),
      url,
    };
  }

  async recent(): Promise<RawHistoryItem[]> {
    return (await this.history.get(HISTORY_KEY)).flatMap((s) => {
      try {
        return [JSON.parse(s) as RawHistoryItem];
      } catch {
        return [];
      }
    });
  }
}

const p = { schema: ProjectIdParamSchema };

@Controller('api/projects/:projectId/rawapi')
export class RawApiController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly raw: RawApiService,
  ) {}

  @Get('apis')
  apis(@ProfileId() profileId: string | undefined, @Param('projectId', p) _projectId: string) {
    return this.raw.list(this.profiles.get(profileId));
  }

  @Get('apis/:api/:version')
  tree(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) _projectId: string,
    @Param('api', { schema: RawApiNameSchema }) api: string,
    @Param('version', { schema: RawApiVersionSchema }) version: string,
  ) {
    return this.raw.tree(this.profiles.get(profileId), api, version);
  }

  @Get('apis/:api/:version/methods/:method')
  method(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) _projectId: string,
    @Param('api', { schema: RawApiNameSchema }) api: string,
    @Param('version', { schema: RawApiVersionSchema }) version: string,
    @Param('method', { schema: RawMethodIdSchema }) methodId: string,
  ) {
    return this.raw.method(this.profiles.get(profileId), api, version, methodId);
  }

  @Get('history')
  history(@Param('projectId', p) _projectId: string) {
    return this.raw.recent();
  }

  /** GET methods: reads, allowed in read-only mode and not audited. */
  @Post('read')
  @HttpCode(200)
  read(@ProfileId() profileId: string | undefined, @Param('projectId', p) _projectId: string, @Body({ schema: RawCallSchema }) b: RawCall) {
    return this.raw.call(this.profiles.get(profileId), b, 'read');
  }

  /** Every other method: a mutation, blocked in read-only mode and audited with the method id (SPEC-0009 D-01). */
  @Post('write/:method')
  @HttpCode(200)
  @Mutation({ product: 'rawapi', verb: ':method', resource: 'projects/:projectId' })
  write(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) _projectId: string,
    @Param('method', { schema: RawMethodIdSchema }) methodId: string,
    @Body({ schema: RawCallSchema }) b: RawCall,
  ) {
    if (b.methodId !== methodId) throw ProblemException.of('INVALID_ARGUMENT', 'The method in the path and in the body differ.');
    return this.raw.call(this.profiles.get(profileId), b, 'write');
  }
}

/** The raw API console (SPEC-0009 M7.1). */
@Module({ controllers: [RawApiController], providers: [RawApiService] })
export class RawApiModule {}
