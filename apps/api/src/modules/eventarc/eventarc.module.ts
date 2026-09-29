import {
  type Confirm,
  ConfirmSchema,
  type CreateTrigger,
  CreateTriggerSchema,
  type EventarcTrigger,
  type EventProvider,
  type ListResponse,
  type OperationAccepted,
  type OperationSummary,
  ProjectIdParamSchema,
  type TriggerDestination,
  TriggerIdSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { lroPoller, type OperationLike, operationGetter } from '../../core/gcp/lro.js';
import { rawJson, timestampToIso } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';

// biome-ignore lint/suspicious/noExplicitAny: Eventarc messages are read and built field by field.
type Any = any;

const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const shortName = (name: string) => name.split('/').pop() ?? name;

function mapDestination(d: Any): TriggerDestination {
  if (d?.cloudRun?.service)
    return {
      kind: 'cloudRun',
      service: String(d.cloudRun.service),
      region: String(d.cloudRun.region ?? ''),
      path: d.cloudRun.path || null,
    };
  if (d?.workflow) return { kind: 'workflow', workflow: String(d.workflow) };
  if (d?.cloudFunction) return { kind: 'cloudFunction', function: String(d.cloudFunction) };
  if (d?.gke?.service) return { kind: 'gke', cluster: String(d.gke.cluster ?? ''), service: String(d.gke.service) };
  if (d?.httpEndpoint?.uri) return { kind: 'http', uri: String(d.httpEndpoint.uri) };
  return { kind: 'unknown' };
}

export function mapTrigger(t: Any): EventarcTrigger {
  const name = String(t?.name ?? '');
  const filters = (t?.eventFilters ?? []).map((f: Any) => ({
    attribute: String(f?.attribute ?? ''),
    value: String(f?.value ?? ''),
    operator: f?.operator || null,
  }));
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    eventType: filters.find((f: { attribute: string }) => f.attribute === 'type')?.value ?? null,
    filters,
    destination: mapDestination(t?.destination),
    serviceAccount: t?.serviceAccount || null,
    transportTopic: t?.transport?.pubsub?.topic || null,
    createTime: timestampToIso(t?.createTime),
    updateTime: timestampToIso(t?.updateTime),
    labels: { ...(t?.labels ?? {}) },
    conditions: Object.entries((t?.conditions ?? {}) as Record<string, Any>).map(([key, c]) => ({
      key,
      code: String(c?.code ?? ''),
      message: String(c?.message ?? ''),
    })),
  };
}

export function mapProvider(p: Any): EventProvider {
  const name = String(p?.name ?? '');
  return {
    name,
    id: shortName(name),
    displayName: String(p?.displayName || shortName(name)),
    eventTypes: (p?.eventTypes ?? []).map((e: Any) => ({
      type: String(e?.type ?? ''),
      description: String(e?.description ?? ''),
      filteringAttributes: (e?.filteringAttributes ?? []).map((a: Any) => ({
        attribute: String(a?.attribute ?? ''),
        description: String(a?.description ?? ''),
        required: Boolean(a?.required),
        pathPatternSupported: Boolean(a?.pathPatternSupported),
      })),
    })),
  };
}

/** Eventarc (SPEC-0003 D-14, CA-28). */
@Injectable()
export class EventarcService {
  private readonly wildcard = new WildcardSupport();

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
  ) {
    for (const kind of ['eventarc.trigger.create', 'eventarc.trigger.delete']) {
      this.operations.registerResumer(kind, (op) => (op.googleName ? this.poller(op.profileId, op.googleName) : null));
    }
  }

  private async client(profileId: string) {
    const { EventarcClient } = await sdk.eventarc();
    return this.clients.get(profileId, 'eventarc', (auth) => new EventarcClient({ auth }));
  }

  private poller(profileId: string, googleName: string) {
    return lroPoller(async (name) => operationGetter((await this.client(profileId)) as never)(name), googleName);
  }

  private track(h: ProfileHandle, kind: string, name: string, displayName: string, op: OperationLike): OperationSummary {
    const googleName = op.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'eventarc',
      kind,
      family: 'longrunning',
      googleName,
      resource: { name, displayName, href: `/p/${projectOf(name)}/eventarc` },
      poll: googleName ? this.poller(h.profile.id, googleName) : async () => ({ done: true }),
    });
  }

  async list(h: ProfileHandle, projectId: string): Promise<ListResponse<EventarcTrigger>> {
    const client = await this.client(h.profile.id);
    const inLocation = async (location: string) => {
      const [items] = await client.listTriggers({ parent: `projects/${projectId}/locations/${location}`, pageSize: 500 });
      return items.map(mapTrigger);
    };
    const result = await this.wildcard.list(
      'eventarc',
      async () => ({ items: await inLocation('-'), nextPageToken: null }),
      async () => {
        const locations: string[] = [];
        for await (const l of client.listLocationsAsync({ name: `projects/${projectId}` })) if (l.locationId) locations.push(l.locationId);
        return fanOut(locations, inLocation);
      },
    );
    result.items.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  }

  async raw(h: ProfileHandle, name: string): Promise<unknown> {
    const [t] = await (await this.client(h.profile.id)).getTrigger({ name });
    return rawJson(t);
  }

  /** The event type catalog of a location, for the create form (CA-28). */
  async providers(h: ProfileHandle, projectId: string, location: string): Promise<EventProvider[]> {
    const [items] = await (await this.client(h.profile.id)).listProviders({
      parent: `projects/${projectId}/locations/${location}`,
      pageSize: 1000,
    });
    return items.map(mapProvider).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async create(h: ProfileHandle, projectId: string, body: CreateTrigger): Promise<OperationSummary> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const d = body.destination;
    const trigger: Any = {
      name: `${parent}/triggers/${body.id}`,
      eventFilters: body.filters.map((f) => ({ attribute: f.attribute, value: f.value, operator: f.operator ?? '' })),
      serviceAccount: body.serviceAccount,
      destination:
        d.kind === 'cloudRun' ? { cloudRun: { service: d.service, region: d.region, path: d.path ?? '' } } : { workflow: d.workflow },
    };
    if (body.transportTopic) trigger.transport = { pubsub: { topic: body.transportTopic } };
    const [op] = await (await this.client(h.profile.id)).createTrigger({ parent, trigger, triggerId: body.id });
    return this.track(h, 'eventarc.trigger.create', trigger.name, `Create trigger ${body.id}`, op);
  }

  async remove(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.client(h.profile.id)).deleteTrigger({ name });
    return this.track(h, 'eventarc.trigger.delete', name, `Delete trigger ${shortName(name)}`, op);
  }
}

const p = { schema: ProjectIdParamSchema };
const loc = {
  schema: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
};
const tid = { schema: TriggerIdSchema };
const TRIGGER = 'projects/:projectId/locations/:location/triggers/:trigger';

@Controller('api/projects/:projectId/eventarc')
export class EventarcController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly eventarc: EventarcService,
  ) {}

  @Get('triggers')
  list(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<EventarcTrigger>> {
    return this.eventarc.list(this.profiles.get(profileId), projectId);
  }

  @Get('providers')
  providers(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({
      schema: z.object({
        location: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z0-9-]+$/),
      }),
    })
    q: { location: string },
  ): Promise<EventProvider[]> {
    return this.eventarc.providers(this.profiles.get(profileId), projectId, q.location);
  }

  @Post('triggers')
  @HttpCode(202)
  @Mutation({ product: 'eventarc', verb: 'trigger.create', resource: 'projects/:projectId/eventarc' })
  async create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateTriggerSchema }) body: CreateTrigger,
  ): Promise<OperationAccepted> {
    return { operation: await this.eventarc.create(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/triggers/:trigger/raw')
  raw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', tid) trigger: string,
  ): Promise<unknown> {
    return this.eventarc.raw(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/triggers/${trigger}`);
  }

  @Delete('locations/:location/triggers/:trigger')
  @HttpCode(202)
  @Mutation({ product: 'eventarc', verb: 'trigger.delete', resource: TRIGGER })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', tid) trigger: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, trigger);
    return {
      operation: await this.eventarc.remove(
        this.profiles.get(profileId),
        `projects/${projectId}/locations/${location}/triggers/${trigger}`,
      ),
    };
  }
}

/** Eventarc (SPEC-0003 §7.7). */
@Module({ controllers: [EventarcController], providers: [EventarcService] })
export class EventarcModule {}
