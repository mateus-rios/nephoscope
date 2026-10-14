import { type LbTopology, ProjectIdParamSchema, type SerialMessage, type SerialParams, SerialParamsSchema } from '@nephoscope/contracts';
import { Controller, Get, Injectable, Module, type OnModuleInit, Param } from '@nestjs/common';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { LiveGateway } from '../../core/live/live.gateway.js';
import type { LiveChannelProvider } from '../../core/live/live.types.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { buildTopology, type TopologyInput } from './topology.js';

// biome-ignore lint/suspicious/noExplicitAny: Compute responses are read field by field.
type Any = any;

const COMPUTE = 'https://compute.googleapis.com/compute/v1/';

/**
 * `compute.serial` (SPEC-0008 D-07): port 1 of an instance, read from the last offset every 2 s.
 * Google keeps about 1 MB; when it moved past the offset, the skipped bytes are reported.
 */
export function serialChannel(intervalMs = 2000): LiveChannelProvider<SerialParams> {
  return {
    channel: 'compute.serial',
    params: SerialParamsSchema,
    open(ctx, sink) {
      let stopped = false;
      let next: string | null = null;
      let timer: NodeJS.Timeout | null = null;
      const url = `${COMPUTE}projects/${ctx.projectId ?? ''}/zones/${ctx.params.zone}/instances/${ctx.params.instance}/serialPort`;
      const tick = async () => {
        if (stopped) return;
        try {
          const r = await rest(ctx.profile, '').get<Any>(url, { port: 1, start: next ?? undefined });
          const start = String(r?.start ?? '0');
          const skipped = next !== null ? Math.max(0, Number(start) - Number(next)) : 0;
          next = String(r?.next ?? start);
          const text = String(r?.contents ?? '');
          if (text || skipped) sink.data({ text, skipped } satisfies SerialMessage);
        } catch (err) {
          sink.error(toProblem(err));
          return;
        }
        if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
      };
      void tick();
      return {
        close() {
          stopped = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  };
}

const AGGREGATED: (keyof TopologyInput)[] = [
  'forwardingRules',
  'targetHttpProxies',
  'targetHttpsProxies',
  'targetTcpProxies',
  'urlMaps',
  'backendServices',
  'targetPools',
  'networkEndpointGroups',
  'instanceGroupManagers',
];

/** Load balancing topology from Compute aggregated lists (SPEC-0008 D-09). */
@Injectable()
export class TopologyService {
  async topology(h: ProfileHandle, projectId: string): Promise<LbTopology> {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const unreachable = new Set<string>();
    const aggregated = async (collection: keyof TopologyInput): Promise<Any[]> => {
      const out: Any[] = [];
      let pageToken: string | undefined;
      do {
        const data = await client.get<Any>(`aggregated/${collection}`, { returnPartialSuccess: true, maxResults: 500, pageToken });
        for (const value of Object.values((data?.items ?? {}) as Record<string, Any>)) out.push(...((value?.[collection] ?? []) as Any[]));
        for (const u of (data?.unreachables ?? []) as string[]) unreachable.add(u);
        pageToken = data?.nextPageToken || undefined;
      } while (pageToken && out.length < 5000);
      return out;
    };
    // SSL proxies and backend buckets are global only; Compute has no aggregated list of SSL proxies.
    const [lists, backendBuckets, targetSslProxies] = await Promise.all([
      Promise.all(AGGREGATED.map((c) => aggregated(c))),
      client.all<Any>('global/backendBuckets', 'items'),
      client.all<Any>('global/targetSslProxies', 'items'),
    ]);
    const input = Object.fromEntries(AGGREGATED.map((c, i) => [c, lists[i] ?? []])) as unknown as TopologyInput;
    input.backendBuckets = backendBuckets;
    input.targetSslProxies = targetSslProxies;
    return buildTopology(projectId, input, [...unreachable]);
  }
}

@Controller('api/projects/:projectId/loadbalancing')
export class TopologyController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly topology: TopologyService,
  ) {}

  @Get('topology')
  get(@ProfileId() profileId: string | undefined, @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string) {
    return this.topology.topology(this.profiles.get(profileId), projectId);
  }
}

/** Compute Engine extras beyond the kit: serial output and the load balancing topology (SPEC-0008 M6.3, M6.4). */
@Module({ controllers: [TopologyController], providers: [TopologyService] })
export class ComputeModule implements OnModuleInit {
  constructor(private readonly live: LiveGateway) {}

  onModuleInit(): void {
    this.live.register(serialChannel());
  }
}
