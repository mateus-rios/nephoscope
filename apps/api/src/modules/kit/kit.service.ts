import {
  findKitCollection,
  GCP_REGIONS,
  type KitActionBody,
  type KitCollection,
  type KitItem,
  type KitListQuery,
  kitCollections,
  type ListResponse,
  type OperationSummary,
  validateKitValues,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import { requireConfirmation } from '../../core/audit/confirm.js';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { type GoogleRest, locationOf, type QueryValue, rest, scopeOf } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import { ProblemException } from '../../core/problem/problem.js';
import { COMPUTE, type KitSource, kitSources } from './sources.js';

// biome-ignore lint/suspicious/noExplicitAny: REST items are passed through as JSON.
type Any = any;

const COMPUTE_LINK = /^https:\/\/(?:www|compute)\.googleapis\.com\/compute\/v1\/projects\/[^/]+\//;

/** The item path of a listed item (KitCollection.pathPattern). */
export function defaultPath(item: Any): string {
  if (typeof item?.selfLink === 'string' && COMPUTE_LINK.test(item.selfLink)) return item.selfLink.replace(COMPUTE_LINK, '');
  const name = typeof item?.name === 'string' ? item.name : '';
  return name.replace(/^projects\/[^/]+\//, '');
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(project|parentId|parent|location)\}/g, (_m, k: string) => vars[k] ?? '');
}

function fillQuery(query: Record<string, QueryValue> | undefined, vars: Record<string, string>): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const [k, v] of Object.entries(query ?? {})) out[k] = typeof v === 'string' ? fill(v, vars) : v;
  return out;
}

/** The descriptor-driven resource kit (SPEC-0001 D-16, D-30). */
@Injectable()
export class KitService {
  private readonly wildcard = new WildcardSupport();
  private readonly numbers = new Map<string, Promise<string>>();

  constructor(private readonly restOps: RestOperations) {}

  resolve(key: string): { collection: KitCollection; source: KitSource } {
    const collection = findKitCollection(key);
    const source = kitSources[key];
    if (!collection || !source) throw ProblemException.of('NOT_FOUND', `Nephoscope has no resource collection ${key}.`);
    return { collection, source };
  }

  private checkPath(collection: KitCollection, path: string): void {
    if (!new RegExp(collection.pathPattern).test(path)) {
      throw ProblemException.of('INVALID_ARGUMENT', `The path does not name a ${collection.singular}.`, {
        errors: [{ path: 'path', message: 'Invalid' }],
      });
    }
  }

  private root(source: KitSource, location: string): string {
    return source.root.replace('{location}', location);
  }

  /** Project number, for the few APIs that name projects by number. Cached per profile. */
  private projectNumber(h: ProfileHandle, project: string): Promise<string> {
    const key = `${h.profile.id}:${project}`;
    let p = this.numbers.get(key);
    if (!p) {
      p = rest(h, 'https://cloudresourcemanager.googleapis.com/v3/')
        .get<{ name?: string }>(`projects/${project}`)
        .then((r) => (r.name ?? '').replace(/^projects\//, ''));
      p.catch(() => this.numbers.delete(key));
      this.numbers.set(key, p);
    }
    return p;
  }

  private async withNumber<T extends string | Record<string, QueryValue> | undefined>(
    h: ProfileHandle,
    project: string,
    value: T,
  ): Promise<T> {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
    if (!text.includes('{number}')) return value;
    const n = await this.projectNumber(h, project);
    if (typeof value === 'string') return value.replaceAll('{number}', n) as T;
    const out: Record<string, QueryValue> = {};
    for (const [k, v] of Object.entries(value ?? {})) out[k] = typeof v === 'string' ? v.replaceAll('{number}', n) : v;
    return out as T;
  }

  private toItem(source: KitSource, raw: Any, location: string, parent = ''): KitItem {
    const item = source.unwrap ? source.unwrap(raw) : raw;
    const path = source.pathOf ? source.pathOf(item, location, parent) : defaultPath(item);
    const loc =
      locationOf(`/${path}`) ||
      scopeOf(`/${path}`) ||
      location ||
      (typeof item?.location === 'string' ? item.location : '') ||
      (typeof item?.region === 'string' ? item.region : '');
    return { ...item, ...(source.decorate?.(item) ?? {}), _path: path, _location: loc };
  }

  /** The full Google name of a parent item, for child lists. */
  private parentName(project: string, parentKey: string | undefined, parentPath: string): string {
    const parentSource = parentKey ? kitSources[parentKey] : undefined;
    return parentSource?.itemRequest ? parentPath : `projects/${project}/${parentPath}`;
  }

  async list(h: ProfileHandle, project: string, key: string, q: KitListQuery): Promise<ListResponse<KitItem>> {
    const { collection, source } = this.resolve(key);
    const parentCollection = kitCollections.find((c) => c.children?.includes(key));
    if (parentCollection && !q.parent)
      throw ProblemException.of('INVALID_ARGUMENT', `Listing ${collection.label.toLowerCase()} needs the parent.`);
    if (q.parent && parentCollection) this.checkPath(parentCollection, q.parent);
    const parent = q.parent ? this.parentName(project, parentCollection?.key, q.parent) : '';
    const vars = { project, parent, parentId: q.parent?.split('/').pop() ?? '', location: q.parent ? locationOf(`/${q.parent}`) : '' };
    const keepCtx = { parent: q.parent ?? '', parentName: parent };
    const map = (items: Any[], location: string) =>
      items
        .filter((raw) => !source.keep || source.keep(source.unwrap ? source.unwrap(raw) : raw, keepCtx))
        .map((raw) => this.toItem(source, raw, location, q.parent ?? ''));

    const list = source.list;
    switch (list.mode) {
      case 'path': {
        const location = locationOf(`/${q.parent ?? ''}`);
        const client = rest(h, this.root(source, location));
        const query = await this.withNumber(h, project, fillQuery(source.query, vars));
        if (list.method === 'POST') {
          const data = await client.call<Any>(fill(list.path, vars), {
            method: 'POST',
            body: {},
            query: { ...query, pageToken: q.pageToken },
          });
          const items = (Array.isArray(data?.[source.itemsKey]) ? data[source.itemsKey] : []) as Any[];
          return { items: map(items, location), nextPageToken: data?.nextPageToken || null };
        }
        const page = await client.page<Any>(fill(list.path, vars), source.itemsKey, { ...query, pageToken: q.pageToken });
        return { items: map(page.items, location), nextPageToken: page.next };
      }
      case 'single': {
        const data = await rest(h, this.root(source, '')).get<Any>(fill(list.path, vars));
        return { items: data ? map([data], '') : [], nextPageToken: null };
      }
      case 'inline': {
        if (!q.parent || !parentCollection) throw ProblemException.of('INVALID_ARGUMENT', 'An inline list needs its parent.');
        const parentItem = await this.get(h, project, parentCollection.key, q.parent);
        const items = (Array.isArray(parentItem[list.field]) ? parentItem[list.field] : []) as Any[];
        return { items: map(items, parentItem._location), nextPageToken: null };
      }
      case 'aggregated': {
        const client = rest(h, COMPUTE);
        const data = await client.get<Any>(`projects/${project}/aggregated/${list.collection}`, {
          returnPartialSuccess: true,
          maxResults: 500,
          pageToken: q.pageToken,
        });
        const items: KitItem[] = [];
        for (const [scope, value] of Object.entries((data?.items ?? {}) as Record<string, Any>)) {
          const location = scope === 'global' ? 'global' : (scope.split('/').pop() ?? '');
          if (q.region && location !== q.region && !location.startsWith(`${q.region}-`)) continue;
          items.push(...map((value?.[source.itemsKey] ?? []) as Any[], location));
        }
        return {
          items,
          nextPageToken: data?.nextPageToken || null,
          unreachable: Array.isArray(data?.unreachables) ? data.unreachables : undefined,
        };
      }
      case 'regions': {
        const regions = q.region ? [q.region] : [...(list.regions ?? GCP_REGIONS)];
        const query = await this.withNumber(h, project, fillQuery(source.query, vars));
        const result = await fanOut(regions, async (location) => {
          const client = rest(h, this.root(source, location));
          const page = await client.page<Any>(fill(list.path, { ...vars, location }), source.itemsKey, query);
          return map(page.items, location);
        });
        return result;
      }
      case 'wildcard': {
        const root = this.root(source, '');
        const client = rest(h, root);
        const query = await this.withNumber(h, project, fillQuery(source.query, vars));
        const perLocation = async (locations: string[]) =>
          fanOut(locations, async (location) => {
            const page = await client.page<Any>(
              list.path.replace('{project}', project).replace('/locations/-/', `/locations/${location}/`),
              source.itemsKey,
              query,
            );
            return map(page.items, location);
          });
        if (q.region) return perLocation([q.region]);
        return this.wildcard.list(
          `${root}${list.path}`,
          async () => {
            const page = await client.page<Any>(fill(list.path, vars), source.itemsKey, { ...query, pageToken: q.pageToken });
            return { items: map(page.items, ''), nextPageToken: page.next };
          },
          async () => perLocation(await this.apiLocations(client, project)),
        );
      }
    }
  }

  /** Locations an API serves the project in, or every region when it cannot say. */
  private async apiLocations(client: GoogleRest, project: string): Promise<string[]> {
    try {
      const all = await client.all<{ locationId?: string }>(`projects/${project}/locations`, 'locations', {}, 500);
      const ids = all.map((l) => l.locationId).filter((l): l is string => !!l);
      if (ids.length > 0) return ids;
    } catch {
      /* Falls back to the region list. */
    }
    return [...GCP_REGIONS, 'global'];
  }

  private async itemRequest(h: ProfileHandle, project: string, source: KitSource, path: string) {
    const custom = source.itemRequest?.(project, path);
    const url = custom?.url ?? `${this.root(source, locationOf(`/${path}`))}projects/${project}/${path}`;
    return {
      url: await this.withNumber(h, project, url),
      query: await this.withNumber(h, project, custom?.query),
      pick: custom?.pick,
    };
  }

  async get(h: ProfileHandle, project: string, key: string, path: string): Promise<KitItem> {
    const { collection, source } = this.resolve(key);
    this.checkPath(collection, path);
    const req = await this.itemRequest(h, project, source, path);
    const data = await rest(h, '').get<Any>(req.url, req.query);
    const raw = req.pick ? req.pick(data) : data;
    if (!raw) throw ProblemException.of('NOT_FOUND', `The ${collection.singular} ${path.split('/').pop()} was not found.`);
    const parentPath = kitCollections.some((c) => c.children?.includes(key)) ? path.split('/').slice(0, -2).join('/') : '';
    const item = this.toItem(source, raw, locationOf(`/${path}`) || scopeOf(`/${path}`), parentPath);
    // Listed and fetched items share the requested path, whatever the API calls them.
    return { ...item, _path: path };
  }

  async extra(h: ProfileHandle, project: string, key: string, path: string, extraId: string): Promise<{ value: unknown }> {
    const { collection, source } = this.resolve(key);
    this.checkPath(collection, path);
    const make = source.extras?.[extraId];
    if (!make || !collection.extras?.some((e) => e.id === extraId))
      throw ProblemException.of('NOT_FOUND', `No ${extraId} for this ${collection.singular}.`);
    const { url: itemUrl } = await this.itemRequest(h, project, source, path);
    const spec = make({ project, path, itemUrl, projectNumber: () => this.projectNumber(h, project) });
    const data = await rest(h, '').get<Any>(await this.withNumber(h, project, spec.url));
    return { value: spec.pick ? spec.pick(data) : data };
  }

  async action(h: ProfileHandle, project: string, key: string, actionId: string, body: KitActionBody): Promise<OperationSummary> {
    const { collection, source } = this.resolve(key);
    const action = collection.actions?.find((a) => a.id === actionId);
    const build = source.actions?.[actionId];
    if (!action || !build) throw ProblemException.of('NOT_FOUND', `No action ${actionId} on ${collection.label.toLowerCase()}.`);
    const scope = action.scope ?? 'item';
    let itemUrl = '';
    let itemQuery: Record<string, QueryValue> | undefined;
    let itemPick: ((data: Any) => Any) | undefined;
    let id = '';
    if (scope === 'item') {
      if (!body.path) throw ProblemException.of('INVALID_ARGUMENT', 'The action needs the item path.');
      this.checkPath(collection, body.path);
      id = body.path.split('/').pop() ?? '';
      if (action.confirm) requireConfirmation(body.confirm, id);
      const req = await this.itemRequest(h, project, source, body.path);
      itemUrl = req.url;
      itemQuery = req.query;
      itemPick = req.pick;
    }
    let parent = '';
    const parentCollection = kitCollections.find((c) => c.children?.includes(key));
    if (scope === 'collection' && parentCollection) {
      if (!body.parent) throw ProblemException.of('INVALID_ARGUMENT', `Creating a ${collection.singular} needs the parent.`);
      this.checkPath(parentCollection, body.parent);
      parent = body.parent;
    }
    const checked = validateKitValues(action.fields ?? [], body.values ?? {});
    if (!checked.ok) throw ProblemException.of('INVALID_ARGUMENT', 'Some values are not valid.', { errors: checked.errors });
    if (scope === 'collection') id = String(checked.values.id ?? '');
    let raw: Promise<Any> | undefined;
    const item = () => {
      if (!itemUrl) return Promise.reject(ProblemException.of('INVALID_ARGUMENT', 'This action has no item.'));
      raw ??= rest(h, '')
        .get<Any>(itemUrl, itemQuery)
        .then((d) => (itemPick ? itemPick(d) : d));
      return raw;
    };
    const req = await build({ project, itemUrl, values: checked.values, item, parent, path: body.path ?? '' });
    const location = locationOf(`/${body.path ?? body.parent ?? ''}`) || String(checked.values.region ?? '');
    const root = this.root(source, location);
    const response = await rest(h, root).call<unknown>(req.path, { method: req.method, query: req.query, body: req.body });
    const [product, collectionId] = key.split('/');
    const deleted = actionId === 'delete';
    const href =
      deleted || scope === 'collection'
        ? parentCollection && parent
          ? `/p/${project}/r/${parentCollection.key}/${parent}`
          : `/p/${project}/${product}`
        : `/p/${project}/r/${product}/${collectionId}/${body.path}`;
    return this.restOps.track(h, {
      projectId: project,
      product: product ?? key,
      kind: `${product}.${collectionId}.${actionId}`,
      resource: { name: body.path ?? id, displayName: `${action.label} ${id}`.trim(), href },
      root,
      response,
    });
  }
}
