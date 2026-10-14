import {
  ARMOR_DEFAULT_PRIORITY,
  type ArmorPolicySummary,
  type ArmorPolicyView,
  type ArmorRule,
  type ArmorTarget,
  type AttachArmor,
  AttachArmorSchema,
  type Confirm,
  ConfirmSchema,
  type CreateArmorPolicy,
  CreateArmorPolicySchema,
  type OperationAccepted,
  ProjectIdParamSchema,
  type ReorderRules,
  ReorderRulesSchema,
  reorderPlan,
  type SaveArmorRule,
  SaveArmorRuleSchema,
  type WafExpressionSet,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations, readOperation } from '../../core/gcp/rest-ops.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Compute REST resources are read field by field.
type Any = any;

const COMPUTE = 'https://compute.googleapis.com/compute/v1/';
const LINK = /^https:\/\/(?:www|compute)\.googleapis\.com\/compute\/v1\/projects\/[^/]+\//;
const pathOf = (selfLink: string) => selfLink.replace(LINK, '');
const scopeOf = (path: string) => /^regions\/([^/]+)\//.exec(path)?.[1] ?? 'global';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function mapRule(r: Any): ArmorRule {
  const cfg = r?.match?.config;
  const expr = r?.match?.expr?.expression;
  return {
    priority: Number(r?.priority ?? 0),
    action: String(r?.action ?? ''),
    description: str(r?.description),
    preview: !!r?.preview,
    match: expr
      ? { kind: 'expr', srcIpRanges: [], expression: String(expr) }
      : cfg?.srcIpRanges
        ? { kind: 'ip', srcIpRanges: (cfg.srcIpRanges as Any[]).map(String), expression: null }
        : { kind: 'other', srcIpRanges: [], expression: null },
    rateLimitOptions: r?.rateLimitOptions ?? null,
    redirectOptions: r?.redirectOptions ?? null,
    headerAction: r?.headerAction ?? null,
  };
}

export function mapPolicy(p: Any, targets: string[]): ArmorPolicyView {
  const path = pathOf(String(p?.selfLink ?? ''));
  const rules = ((p?.rules ?? []) as Any[]).map(mapRule).sort((a, b) => a.priority - b.priority);
  return {
    path,
    name: String(p?.name ?? ''),
    scope: scopeOf(path),
    type: String(p?.type ?? 'CLOUD_ARMOR'),
    description: str(p?.description),
    ruleCount: rules.length,
    adaptiveProtection: !!p?.adaptiveProtectionConfig?.layer7DdosDefenseConfig?.enable,
    labels: (p?.labels ?? {}) as Record<string, string>,
    targets,
    fingerprint: str(p?.fingerprint),
    rules,
    raw: p,
  };
}

/** The REST body of a rule (SPEC-0007 D-09). */
export function ruleBody(r: SaveArmorRule): Any {
  return {
    priority: r.priority,
    action: r.action,
    description: r.description,
    preview: r.preview,
    match:
      r.match.kind === 'ip'
        ? { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: r.match.srcIpRanges } }
        : { expr: { expression: r.match.expression } },
    ...(r.rateLimitOptions ? { rateLimitOptions: r.rateLimitOptions } : {}),
    ...(r.redirectOptions ? { redirectOptions: r.redirectOptions } : {}),
    ...(r.headerAction ? { headerAction: r.headerAction } : {}),
  };
}

/** Cloud Armor through Compute REST (SPEC-0007 D-09, SPEC-0001 D-29). */
@Injectable()
export class ArmorService {
  /** Delay between polls of a Compute operation during a reorder. */
  pollMs = 1500;

  constructor(
    private readonly restOps: RestOperations,
    private readonly operations: OperationsService,
  ) {}

  async targets(h: ProfileHandle, projectId: string): Promise<ArmorTarget[]> {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const [services, buckets] = await Promise.all([
      client.get<Any>('aggregated/backendServices', { returnPartialSuccess: true, maxResults: 500 }),
      client.all<Any>('global/backendBuckets', 'items', { maxResults: 500 }).catch(() => [] as Any[]),
    ]);
    const out: ArmorTarget[] = [];
    for (const v of Object.values((services?.items ?? {}) as Record<string, Any>)) {
      for (const s of (v?.backendServices ?? []) as Any[]) {
        const path = pathOf(String(s.selfLink ?? ''));
        out.push({
          path,
          name: String(s.name ?? ''),
          scope: scopeOf(path),
          kind: 'backendService',
          scheme: str(s.loadBalancingScheme),
          securityPolicy: s.securityPolicy ? pathOf(String(s.securityPolicy)) : null,
          edgeSecurityPolicy: s.edgeSecurityPolicy ? pathOf(String(s.edgeSecurityPolicy)) : null,
        });
      }
    }
    for (const b of buckets) {
      const path = pathOf(String(b.selfLink ?? ''));
      out.push({
        path,
        name: String(b.name ?? ''),
        scope: 'global',
        kind: 'backendBucket',
        scheme: null,
        securityPolicy: null,
        edgeSecurityPolicy: b.edgeSecurityPolicy ? pathOf(String(b.edgeSecurityPolicy)) : null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(h: ProfileHandle, projectId: string): Promise<{ items: ArmorPolicySummary[]; unreachable: string[] }> {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const [data, targets] = await Promise.all([
      client.get<Any>('aggregated/securityPolicies', { returnPartialSuccess: true, maxResults: 500 }),
      this.targets(h, projectId).catch(() => [] as ArmorTarget[]),
    ]);
    const items: ArmorPolicySummary[] = [];
    for (const v of Object.values((data?.items ?? {}) as Record<string, Any>)) {
      for (const p of (v?.securityPolicies ?? []) as Any[]) {
        const path = pathOf(String(p.selfLink ?? ''));
        const using = targets.filter((t) => t.securityPolicy === path || t.edgeSecurityPolicy === path).map((t) => t.path);
        const { rules: _r, raw: _raw, fingerprint: _f, ...summary } = mapPolicy(p, using);
        items.push(summary);
      }
    }
    return {
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      unreachable: Array.isArray(data?.unreachables) ? data.unreachables : [],
    };
  }

  async get(h: ProfileHandle, projectId: string, path: string): Promise<ArmorPolicyView> {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const [p, targets] = await Promise.all([client.get<Any>(path), this.targets(h, projectId).catch(() => [] as ArmorTarget[])]);
    return mapPolicy(
      p,
      targets.filter((t) => t.securityPolicy === path || t.edgeSecurityPolicy === path).map((t) => t.path),
    );
  }

  async wafSets(h: ProfileHandle, projectId: string): Promise<WafExpressionSet[]> {
    const r = await rest(h, `${COMPUTE}projects/${projectId}/`).get<Any>('global/securityPolicies/listPreconfiguredExpressionSets');
    return ((r?.preconfiguredExpressionSets?.wafRules?.expressionSets ?? []) as Any[]).map((s) => ({
      id: String(s?.id ?? ''),
      aliases: ((s?.aliases ?? []) as Any[]).map(String),
      expressions: ((s?.expressions ?? []) as Any[]).map((e) => ({
        id: String(e?.id ?? ''),
        sensitivity: typeof e?.sensitivity === 'number' ? e.sensitivity : null,
      })),
    }));
  }

  private track(h: ProfileHandle, projectId: string, kind: string, path: string, displayName: string, response: unknown) {
    return this.restOps.track(h, {
      projectId,
      product: 'armor',
      kind,
      resource: { name: path, displayName, href: `/p/${projectId}/armor/${scopeOf(path)}/${path.split('/').pop()}` },
      root: COMPUTE,
      response,
    });
  }

  async create(h: ProfileHandle, projectId: string, b: CreateArmorPolicy) {
    const parent = b.scope === 'global' ? 'global/securityPolicies' : `regions/${b.scope}/securityPolicies`;
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).post(parent, { name: b.name, description: b.description, type: b.type });
    return this.track(h, projectId, 'armor.policy.create', `${parent}/${b.name}`, `Create security policy ${b.name}`, op);
  }

  async remove(h: ProfileHandle, projectId: string, path: string) {
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).delete(path);
    return this.track(h, projectId, 'armor.policy.delete', path, `Delete security policy ${path.split('/').pop()}`, op);
  }

  async addRule(h: ProfileHandle, projectId: string, path: string, r: SaveArmorRule) {
    if (r.priority === ARMOR_DEFAULT_PRIORITY)
      throw ProblemException.of('INVALID_ARGUMENT', 'The default rule already exists; edit its action instead.');
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).post(`${path}/addRule`, ruleBody(r));
    return this.track(h, projectId, 'armor.rule.add', path, `Add rule ${r.priority}`, op);
  }

  async patchRule(h: ProfileHandle, projectId: string, path: string, priority: number, r: SaveArmorRule) {
    if (r.priority !== priority) throw ProblemException.of('INVALID_ARGUMENT', 'Change a priority by reordering the rules.');
    const body = priority === ARMOR_DEFAULT_PRIORITY ? { priority, action: r.action, description: r.description } : ruleBody(r);
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).post(`${path}/patchRule`, body, { priority });
    return this.track(h, projectId, 'armor.rule.patch', path, `Update rule ${priority}`, op);
  }

  async removeRule(h: ProfileHandle, projectId: string, path: string, priority: number) {
    if (priority === ARMOR_DEFAULT_PRIORITY)
      throw ProblemException.of('FAILED_PRECONDITION', 'The default rule cannot be deleted; change its action instead.');
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).post(`${path}/removeRule`, {}, { priority });
    return this.track(h, projectId, 'armor.rule.remove', path, `Delete rule ${priority}`, op);
  }

  async setAdaptive(h: ProfileHandle, projectId: string, path: string, enable: boolean) {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const p = await client.get<Any>(path);
    const op = await client.patch(path, { adaptiveProtectionConfig: { layer7DdosDefenseConfig: { enable } }, fingerprint: p?.fingerprint });
    return this.track(
      h,
      projectId,
      `armor.adaptive.${enable ? 'enable' : 'disable'}`,
      path,
      `${enable ? 'Turn on' : 'Turn off'} adaptive protection`,
      op,
    );
  }

  async attach(h: ProfileHandle, projectId: string, path: string, b: AttachArmor) {
    const verb = b.slot === 'edge' ? 'setEdgeSecurityPolicy' : 'setSecurityPolicy';
    const op = await rest(h, `${COMPUTE}projects/${projectId}/`).post(
      `${b.target}/${verb}`,
      b.attach ? { securityPolicy: `${COMPUTE}projects/${projectId}/${path}` } : {},
    );
    return this.track(
      h,
      projectId,
      `armor.${b.attach ? 'attach' : 'detach'}`,
      path,
      `${b.attach ? 'Attach to' : 'Detach from'} ${b.target.split('/').pop()}`,
      op,
    );
  }

  /**
   * Applies a reorder plan rule by rule as one local operation (SPEC-0007 D-09): each step copies
   * the rule to its new priority, waits, removes the old one, waits. Cancelling stops between steps.
   */
  async reorder(h: ProfileHandle, projectId: string, path: string, body: ReorderRules) {
    const client = rest(h, `${COMPUTE}projects/${projectId}/`);
    const policy = await client.get<Any>(path);
    const current = ((policy?.rules ?? []) as Any[]).map((r) => Number(r.priority));
    let plan: ReturnType<typeof reorderPlan>;
    try {
      plan = reorderPlan(current, body.order);
    } catch (err) {
      throw ProblemException.of('CONFLICT', `${(err as Error).message} The rules changed since the plan was made; reload them.`);
    }
    requireConfirmation(body.confirm, String(plan.length));
    // Not cancellable: a step that stopped between its add and its remove would leave the rule twice.
    const wait = async (op: Any) => {
      for (;;) {
        const r = readOperation('compute', await client.get<Any>(String(op.selfLink)));
        if (r.done) {
          if (r.error) throw new ProblemException(r.error);
          return;
        }
        await new Promise((res) => setTimeout(res, this.pollMs));
      }
    };
    return this.operations.trackLocal(
      {
        profileId: h.profile.id,
        projectId,
        product: 'armor',
        kind: 'armor.rules.reorder',
        resource: {
          name: path,
          displayName: `Reorder rules of ${path.split('/').pop()}`,
          href: `/p/${projectId}/armor/${scopeOf(path)}/${path.split('/').pop()}`,
        },
      },
      async (report, signal) => {
        for (const [i, step] of plan.entries()) {
          if (signal.aborted) return `Stopped after ${i} of ${plan.length} steps.`;
          report((i / plan.length) * 100, `Moving rule ${step.from} to ${step.to}`);
          const rule = await client.get<Any>(`${path}/getRule`, { priority: step.from });
          const { kind: _k, ...copy } = rule ?? {};
          await wait(await client.post(`${path}/addRule`, { ...copy, priority: step.to }));
          await wait(await client.post(`${path}/removeRule`, {}, { priority: step.from }));
        }
        return `Applied ${plan.length} priority changes.`;
      },
    );
  }
}

const p = { schema: ProjectIdParamSchema };
const scope = { schema: z.string().regex(/^[a-z0-9-]{1,64}$/) };
const policyName = { schema: z.string().regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/) };
const prio = { schema: z.coerce.number().int().min(0).max(ARMOR_DEFAULT_PRIORITY) };
const policyPath = (s: string, n: string) => (s === 'global' ? `global/securityPolicies/${n}` : `regions/${s}/securityPolicies/${n}`);
const POLICY = 'projects/:projectId/:scope/securityPolicies/:policy';

@Controller('api/projects/:projectId/armor')
export class ArmorController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly armor: ArmorService,
  ) {}

  private accepted(res: Response, operation: OperationAccepted['operation']): OperationAccepted {
    res.status(operation.family === 'instant' ? 200 : 202);
    return { operation };
  }

  @Get('policies')
  list(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.armor.list(this.profiles.get(profileId), projectId);
  }

  @Get('targets')
  targets(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ArmorTarget[]> {
    return this.armor.targets(this.profiles.get(profileId), projectId);
  }

  @Get('waf')
  waf(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<WafExpressionSet[]> {
    return this.armor.wafSets(this.profiles.get(profileId), projectId);
  }

  @Post('policies')
  @Mutation({ product: 'armor', verb: 'policy.create', resource: 'projects/:projectId/securityPolicies' })
  async create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateArmorPolicySchema }) body: CreateArmorPolicy,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.armor.create(this.profiles.get(profileId), projectId, body));
  }

  @Get('policies/:scope/:policy')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
  ): Promise<ArmorPolicyView> {
    return this.armor.get(this.profiles.get(profileId), projectId, policyPath(s, n));
  }

  @Delete('policies/:scope/:policy')
  @Mutation({ product: 'armor', verb: 'policy.delete', resource: POLICY })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireConfirmation(body.confirm, n);
    return this.accepted(res, await this.armor.remove(this.profiles.get(profileId), projectId, policyPath(s, n)));
  }

  @Post('policies/:scope/:policy/rules')
  @Mutation({ product: 'armor', verb: 'rule.add', resource: POLICY })
  async addRule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Body({ schema: SaveArmorRuleSchema }) body: SaveArmorRule,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.armor.addRule(this.profiles.get(profileId), projectId, policyPath(s, n), body));
  }

  @Put('policies/:scope/:policy/rules/:priority')
  @Mutation({ product: 'armor', verb: 'rule.patch', resource: POLICY })
  async patchRule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Param('priority', prio) priority: number,
    @Body({ schema: SaveArmorRuleSchema }) body: SaveArmorRule,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.armor.patchRule(this.profiles.get(profileId), projectId, policyPath(s, n), priority, body));
  }

  @Delete('policies/:scope/:policy/rules/:priority')
  @Mutation({ product: 'armor', verb: 'rule.remove', resource: POLICY })
  async removeRule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Param('priority', prio) priority: number,
    @Body({ schema: ConfirmSchema }) body: Confirm,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireConfirmation(body.confirm, String(priority));
    return this.accepted(res, await this.armor.removeRule(this.profiles.get(profileId), projectId, policyPath(s, n), priority));
  }

  @Post('policies/:scope/:policy/reorder')
  @HttpCode(202)
  @Mutation({ product: 'armor', verb: 'rules.reorder', resource: POLICY })
  async reorder(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Body({ schema: ReorderRulesSchema }) body: ReorderRules,
  ) {
    return { operation: await this.armor.reorder(this.profiles.get(profileId), projectId, policyPath(s, n), body) };
  }

  @Patch('policies/:scope/:policy/adaptive')
  @Mutation({ product: 'armor', verb: 'adaptive.set', resource: POLICY })
  async adaptive(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Body({ schema: z.object({ enable: z.boolean() }) }) body: { enable: boolean },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.armor.setAdaptive(this.profiles.get(profileId), projectId, policyPath(s, n), body.enable));
  }

  @Post('policies/:scope/:policy/attach')
  @Mutation({ product: 'armor', verb: 'policy.attach', resource: POLICY })
  async attach(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('scope', scope) s: string,
    @Param('policy', policyName) n: string,
    @Body({ schema: AttachArmorSchema }) body: AttachArmor,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.armor.attach(this.profiles.get(profileId), projectId, policyPath(s, n), body));
  }
}

/** Cloud Armor (SPEC-0007 M5.3). */
@Module({ controllers: [ArmorController], providers: [ArmorService] })
export class ArmorModule {}
