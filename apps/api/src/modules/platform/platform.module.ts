import {
  type BillingView,
  type OrgPoliciesView,
  ProjectIdParamSchema,
  type QuotaPreferenceView,
  QuotaServiceSchema,
  type QuotasView,
  type RecommendationsView,
} from '@nephoscope/contracts';
import { Controller, Get, Injectable, Module, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import {
  mapBudget,
  mapInsight,
  mapPreference,
  mapRecommendation,
  orgPolicyRow,
  quotaRows,
  sortPolicies,
  withUsage,
} from './platform.mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: REST resources are read field by field.
type Any = any;

const BILLING = 'https://cloudbilling.googleapis.com/v1/';
const BUDGETS = 'https://billingbudgets.googleapis.com/v1/';
const QUOTAS = 'https://cloudquotas.googleapis.com/v1/';
const MONITORING = 'https://monitoring.googleapis.com/v3/';
const RECOMMENDER = 'https://recommender.googleapis.com/v1/';
const ORGPOLICY = 'https://orgpolicy.googleapis.com/v2/';
const COMPUTE = 'https://compute.googleapis.com/compute/v1/';

const detail = (err: unknown) => toProblem(err).detail;

/** Recommenders and insight types that apply to the products Nephoscope covers (D-04). */
export const RECOMMENDERS: { id: string; scope: 'global' | 'zone' | 'region' }[] = [
  { id: 'google.iam.policy.Recommender', scope: 'global' },
  { id: 'google.resourcemanager.projectUtilization.Recommender', scope: 'global' },
  { id: 'google.compute.image.IdleResourceRecommender', scope: 'global' },
  { id: 'google.compute.instance.MachineTypeRecommender', scope: 'zone' },
  { id: 'google.compute.instance.IdleResourceRecommender', scope: 'zone' },
  { id: 'google.compute.disk.IdleResourceRecommender', scope: 'zone' },
  { id: 'google.compute.address.IdleResourceRecommender', scope: 'region' },
  { id: 'google.cloudsql.instance.IdleRecommender', scope: 'region' },
  { id: 'google.cloudsql.instance.OverprovisionedRecommender', scope: 'region' },
  { id: 'google.run.service.SecurityRecommender', scope: 'region' },
];
export const INSIGHT_TYPES: { id: string; scope: 'global' }[] = [
  { id: 'google.iam.policy.Insight', scope: 'global' },
  { id: 'google.iam.serviceAccount.Insight', scope: 'global' },
  { id: 'google.compute.firewall.Insight', scope: 'global' },
];

@Injectable()
export class PlatformService {
  private readonly numbers = new Map<string, string>();
  private readonly policyCache = new Map<string, { at: number; view: OrgPoliciesView }>();

  private async projectNumber(h: ProfileHandle, projectId: string): Promise<string | null> {
    const key = `${h.profile.id}:${projectId}`;
    if (this.numbers.has(key)) return this.numbers.get(key) ?? null;
    try {
      const p = await rest(h, 'https://cloudresourcemanager.googleapis.com/v3/').get<Any>(`projects/${projectId}`);
      const n = String(p?.name ?? '').replace(/^projects\//, '');
      this.numbers.set(key, n);
      return n;
    } catch {
      return null;
    }
  }

  /** The project's billing account and budgets; costs come from the export (D-02). */
  async billing(h: ProfileHandle, projectId: string): Promise<BillingView> {
    const info = await rest(h, BILLING).get<Any>(`projects/${projectId}/billingInfo`);
    const account = typeof info?.billingAccountName === 'string' && info.billingAccountName ? String(info.billingAccountName) : null;
    const view: BillingView = {
      billingEnabled: !!info?.billingEnabled,
      account,
      accountDisplayName: null,
      accountOpen: null,
      accountError: null,
      budgets: null,
      budgetsError: null,
    };
    if (!account) return view;
    try {
      const a = await rest(h, BILLING).get<Any>(account);
      view.accountDisplayName = a?.displayName ?? null;
      view.accountOpen = typeof a?.open === 'boolean' ? a.open : null;
    } catch (err) {
      view.accountError = detail(err);
    }
    try {
      const number = await this.projectNumber(h, projectId);
      view.budgets = (await rest(h, BUDGETS).all<Any>(`${account}/budgets`, 'budgets', {}, 500)).map((b) => mapBudget(b, number));
    } catch (err) {
      view.budgetsError = detail(err);
    }
    return view;
  }

  /** Quota infos of a service with usage where Cloud Monitoring reports it (D-03). */
  async quotas(h: ProfileHandle, projectId: string, service: string): Promise<QuotasView> {
    const infos = await rest(h, QUOTAS).all<Any>(
      `projects/${projectId}/locations/global/services/${service}/quotaInfos`,
      'quotaInfos',
      {},
      5000,
    );
    const rows = infos.flatMap(quotaRows);
    let usageError: string | null = null;
    let series: Any[] = [];
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 86_400_000);
      series = await rest(h, MONITORING).all<Any>(
        `projects/${projectId}/timeSeries`,
        'timeSeries',
        {
          filter: `metric.type="serviceruntime.googleapis.com/quota/allocation/usage" AND resource.type="consumer_quota" AND resource.labels.service="${service}"`,
          'interval.startTime': start.toISOString(),
          'interval.endTime': end.toISOString(),
          'aggregation.alignmentPeriod': '86400s',
          'aggregation.perSeriesAligner': 'ALIGN_MAX',
        },
        5000,
      );
    } catch (err) {
      usageError = detail(err);
    }
    const withUse = withUsage(rows, series);
    withUse.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.displayName.localeCompare(b.displayName));
    return { service, rows: withUse, usageError };
  }

  async pendingQuotas(h: ProfileHandle, projectId: string): Promise<QuotaPreferenceView[]> {
    const all = await rest(h, QUOTAS).all<Any>(
      `projects/${projectId}/locations/global/quotaPreferences`,
      'quotaPreferences',
      { filter: 'reconciling=true' },
      500,
    );
    return all.map(mapPreference);
  }

  /** Zones and regions the project has resources in, for the zonal and regional recommenders. */
  private async usedLocations(h: ProfileHandle, projectId: string): Promise<{ zones: string[]; regions: string[] }> {
    const zones = new Set<string>();
    const regions = new Set<string>();
    const scopes = async (collection: string) => {
      try {
        const data = await rest(h, COMPUTE).get<Any>(`projects/${projectId}/aggregated/${collection}`, {
          returnPartialSuccess: true,
          maxResults: 500,
        });
        for (const [scope, v] of Object.entries((data?.items ?? {}) as Record<string, Any>)) {
          if (!(v?.[collection] ?? []).length) continue;
          const [kind, name] = scope.split('/');
          if (kind === 'zones' && name) {
            zones.add(name);
            regions.add(name.replace(/-[a-z]$/, ''));
          }
          if (kind === 'regions' && name) regions.add(name);
        }
      } catch {
        // Compute disabled or unreadable: only the global recommenders run.
      }
    };
    const sqlRegions = async () => {
      try {
        const data = await rest(h, 'https://sqladmin.googleapis.com/v1/').get<Any>(`projects/${projectId}/instances`);
        for (const i of (data?.items ?? []) as Any[]) if (i?.region) regions.add(String(i.region));
      } catch {
        // Cloud SQL disabled or unreadable.
      }
    };
    const runRegions = async () => {
      try {
        const data = await rest(h, 'https://run.googleapis.com/v2/').get<Any>(`projects/${projectId}/locations/-/services`);
        for (const s of (data?.services ?? []) as Any[]) {
          const r = /\/locations\/([^/]+)\//.exec(String(s?.name ?? ''))?.[1];
          if (r) regions.add(r);
        }
      } catch {
        // Cloud Run disabled or unreadable.
      }
    };
    await Promise.all([scopes('instances'), scopes('disks'), scopes('addresses'), sqlRegions(), runRegions()]);
    return { zones: [...zones].sort(), regions: [...regions].sort() };
  }

  /** Recommendations and insights of the recommenders that apply (D-04). */
  async recommendations(h: ProfileHandle, projectId: string): Promise<RecommendationsView> {
    const { zones, regions } = await this.usedLocations(h, projectId);
    const at = (scope: 'global' | 'zone' | 'region') => (scope === 'global' ? ['global'] : scope === 'zone' ? zones : regions);
    const recKeys = RECOMMENDERS.flatMap((r) => at(r.scope).map((l) => `${r.id}@${l}`));
    const insightKeys = INSIGHT_TYPES.map((i) => `${i.id}@global`);
    const client = rest(h, RECOMMENDER);
    const [recs, insights] = await Promise.all([
      fanOut(recKeys, async (key) => {
        const [id = '', location = ''] = key.split('@');
        const items = await client.all<Any>(
          `projects/${projectId}/locations/${location}/recommenders/${id}/recommendations`,
          'recommendations',
          {},
          500,
        );
        return items.map((r) => mapRecommendation(r, id, location));
      }),
      fanOut(insightKeys, async (key) => {
        const [id = '', location = ''] = key.split('@');
        const items = await client.all<Any>(`projects/${projectId}/locations/${location}/insightTypes/${id}/insights`, 'insights', {}, 500);
        return items.map((i) => mapInsight(i, id, location));
      }).catch(() => ({ items: [], unreachable: insightKeys })),
    ]);
    const priority = (p: string | null) => ['P1', 'P2', 'P3', 'P4'].indexOf(p ?? 'P4');
    return {
      recommendations: recs.items.filter((r) => r.state === 'ACTIVE').sort((a, b) => priority(a.priority) - priority(b.priority)),
      insights: insights.items.filter((i) => i.state === 'ACTIVE'),
      unreachable: [...(recs.unreachable ?? []), ...(insights.unreachable ?? [])],
    };
  }

  /** Effective organization policies of the project, important ones first (D-05). Kept 5 minutes. */
  async orgPolicies(h: ProfileHandle, projectId: string, refresh: boolean): Promise<OrgPoliciesView> {
    const key = `${h.profile.id}:${projectId}`;
    const hit = this.policyCache.get(key);
    if (hit && !refresh && Date.now() - hit.at < 5 * 60_000) return hit.view;
    const client = rest(h, ORGPOLICY);
    const [constraints, set] = await Promise.all([
      client.all<Any>(`projects/${projectId}/constraints`, 'constraints', {}, 3000),
      client.all<Any>(`projects/${projectId}/policies`, 'policies', {}, 3000).catch(() => [] as Any[]),
    ]);
    const setIds = new Set(
      set.map((p) =>
        String(p?.name ?? '')
          .split('/')
          .pop(),
      ),
    );
    const ids = constraints
      .map(
        (c) =>
          String(c?.name ?? '')
            .split('/')
            .pop() ?? '',
      )
      .filter(Boolean);
    const effective = new Map<string, Any>();
    const result = await fanOut(
      ids,
      async (id) => {
        const p = await client.get<Any>(`projects/${projectId}/policies/${id}:getEffectivePolicy`);
        effective.set(id, p?.spec ?? null);
        return [id];
      },
      10,
    ).catch(() => ({ items: [] as string[], unreachable: ids }));
    const policies = sortPolicies(
      constraints
        .filter((c) =>
          effective.has(
            String(c?.name ?? '')
              .split('/')
              .pop() ?? '',
          ),
        )
        .map((c) => {
          const id =
            String(c?.name ?? '')
              .split('/')
              .pop() ?? '';
          return orgPolicyRow(c, effective.get(id), setIds.has(id));
        }),
    );
    const view = { policies, unreadable: result.unreachable ?? [] };
    this.policyCache.set(key, { at: Date.now(), view });
    return view;
  }
}

const p = { schema: ProjectIdParamSchema };

@Controller('api/projects/:projectId')
export class PlatformController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly platform: PlatformService,
  ) {}

  @Get('billing')
  billing(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.platform.billing(this.profiles.get(profileId), projectId);
  }

  @Get('quotas')
  quotas(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: z.object({ service: QuotaServiceSchema }) }) q: { service: string },
  ) {
    return this.platform.quotas(this.profiles.get(profileId), projectId, q.service);
  }

  @Get('quotas/pending')
  pending(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.platform.pendingQuotas(this.profiles.get(profileId), projectId);
  }

  @Get('recommendations')
  recommendations(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.platform.recommendations(this.profiles.get(profileId), projectId);
  }

  @Get('orgpolicies')
  orgPolicies(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: z.object({ refresh: z.enum(['true', 'false']).optional() }) }) q: { refresh?: string },
  ) {
    return this.platform.orgPolicies(this.profiles.get(profileId), projectId, q.refresh === 'true');
  }
}

/** Billing, quotas, recommendations and organization policies (SPEC-0009 M7.2). */
@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class GovernanceModule {}
