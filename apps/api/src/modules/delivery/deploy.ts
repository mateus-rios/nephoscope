import {
  type DeployPipelineView,
  type DeployReleaseView,
  type DeployRolloutView,
  type DeployTargetView,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  PromoteReleaseSchema,
  type RolloutAction,
  type RolloutActionBody,
  RolloutActionSchema,
  rolloutActions,
} from '@nephoscope/contracts';
import { Body, Controller, Get, Injectable, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Cloud Deploy REST resources are read field by field.
type Any = any;

export const CLOUDDEPLOY = 'https://clouddeploy.googleapis.com/v1/';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (n: string) => n.split('/').pop() ?? n;
const locOf = (n: string) => /\/locations\/([^/]+)\//.exec(n)?.[1] ?? '';

export function mapPipeline(p: Any): DeployPipelineView {
  const name = String(p?.name ?? '');
  return {
    name,
    id: short(name),
    location: locOf(name),
    description: str(p?.description),
    stages: ((p?.serialPipeline?.stages ?? []) as Any[]).map((s) => ({
      targetId: String(s?.targetId ?? ''),
      profiles: ((s?.profiles ?? []) as Any[]).map(String),
      strategy: s?.strategy?.canary ? 'canary' : s?.strategy?.standard ? 'standard' : null,
    })),
    suspended: !!p?.suspended,
    createTime: str(p?.createTime),
    updateTime: str(p?.updateTime),
  };
}

export function mapTarget(t: Any): DeployTargetView {
  const name = String(t?.name ?? '');
  const kind = t?.run
    ? 'Cloud Run'
    : t?.gke
      ? 'GKE'
      : t?.anthosCluster
        ? 'GKE Enterprise'
        : t?.multiTarget
          ? 'Multi-target'
          : t?.customTarget
            ? 'Custom'
            : 'Other';
  return {
    name,
    id: short(name),
    location: locOf(name),
    description: str(t?.description),
    kind,
    detail:
      str(t?.run?.location) ??
      str(t?.gke?.cluster) ??
      str(t?.anthosCluster?.membership) ??
      (t?.multiTarget ? ((t.multiTarget.targetIds ?? []) as Any[]).join(', ') : null),
    requireApproval: !!t?.requireApproval,
  };
}

export function mapRelease(r: Any): DeployReleaseView {
  const name = String(r?.name ?? '');
  return {
    name,
    id: short(name),
    renderState: String(r?.renderState ?? 'RENDER_STATE_UNSPECIFIED'),
    abandoned: !!r?.abandoned,
    createTime: str(r?.createTime),
    targetRenders: Object.fromEntries(
      Object.entries((r?.targetRenders ?? {}) as Record<string, Any>).map(([k, v]) => [k, String(v?.renderingState ?? '')]),
    ),
  };
}

export function mapRollout(r: Any): DeployRolloutView {
  const name = String(r?.name ?? '');
  return {
    name,
    id: short(name),
    targetId: String(r?.targetId ?? ''),
    state: String(r?.state ?? 'STATE_UNSPECIFIED'),
    approvalState: String(r?.approvalState ?? 'APPROVAL_STATE_UNSPECIFIED'),
    createTime: str(r?.createTime),
    deployStartTime: str(r?.deployStartTime),
    deployEndTime: str(r?.deployEndTime),
    failureReason: str(r?.failureReason),
    phases: ((r?.phases ?? []) as Any[]).map((ph) => ({
      id: String(ph?.id ?? ''),
      state: String(ph?.state ?? ''),
      jobs: (
        ((ph?.deploymentJobs?.deployJob ? [ph.deploymentJobs.deployJob] : []) as Any[]).concat(
          ph?.deploymentJobs?.verifyJob ? [ph.deploymentJobs.verifyJob] : [],
        ) as Any[]
      ).map((j) => ({
        id: String(j?.id ?? ''),
        state: String(j?.state ?? ''),
      })),
    })),
  };
}

/** The next target of a pipeline after the release's latest successful rollout (SPEC-0007 D-13). */
export function nextTarget(pipeline: DeployPipelineView, rollouts: DeployRolloutView[]): string | null {
  const order = pipeline.stages.map((s) => s.targetId);
  const done = rollouts.filter((r) => r.state === 'SUCCEEDED').map((r) => order.indexOf(r.targetId));
  const last = done.length ? Math.max(...done) : -1;
  return order[last + 1] ?? null;
}

/** Cloud Deploy through REST (SPEC-0007 D-13). */
@Injectable()
export class DeployService {
  private readonly locations = new Map<string, Promise<string[]>>();

  constructor(private readonly restOps: RestOperations) {}

  private locs(h: ProfileHandle, projectId: string): Promise<string[]> {
    const key = `${h.profile.id}:${projectId}`;
    let p = this.locations.get(key);
    if (!p) {
      p = rest(h, CLOUDDEPLOY)
        .all<Any>(`projects/${projectId}/locations`, 'locations', {}, 500)
        .then((l) => l.map((x) => String(x.locationId ?? '')).filter(Boolean));
      p.catch(() => this.locations.delete(key));
      this.locations.set(key, p);
    }
    return p;
  }

  async pipelines(h: ProfileHandle, projectId: string, location: string): Promise<ListResponse<DeployPipelineView>> {
    const client = rest(h, CLOUDDEPLOY);
    const one = async (l: string) =>
      (await client.all<Any>(`projects/${projectId}/locations/${l}/deliveryPipelines`, 'deliveryPipelines', { pageSize: 500 })).map(
        mapPipeline,
      );
    if (location !== 'all') return { items: await one(location), nextPageToken: null };
    return fanOut(await this.locs(h, projectId), one);
  }

  async targets(h: ProfileHandle, projectId: string, location: string): Promise<ListResponse<DeployTargetView>> {
    const client = rest(h, CLOUDDEPLOY);
    const one = async (l: string) =>
      (await client.all<Any>(`projects/${projectId}/locations/${l}/targets`, 'targets', { pageSize: 500 })).map(mapTarget);
    if (location !== 'all') return { items: await one(location), nextPageToken: null };
    return fanOut(await this.locs(h, projectId), one);
  }

  async pipeline(h: ProfileHandle, projectId: string, location: string, id: string): Promise<DeployPipelineView> {
    return mapPipeline(await rest(h, CLOUDDEPLOY).get(`projects/${projectId}/locations/${location}/deliveryPipelines/${id}`));
  }

  async releases(h: ProfileHandle, projectId: string, location: string, pipeline: string): Promise<DeployReleaseView[]> {
    const list = await rest(h, CLOUDDEPLOY).all<Any>(
      `projects/${projectId}/locations/${location}/deliveryPipelines/${pipeline}/releases`,
      'releases',
      { pageSize: 200, orderBy: 'create_time desc' },
      400,
    );
    return list.map(mapRelease);
  }

  async rollouts(h: ProfileHandle, projectId: string, location: string, pipeline: string, release: string): Promise<DeployRolloutView[]> {
    const list = await rest(h, CLOUDDEPLOY).all<Any>(
      `projects/${projectId}/locations/${location}/deliveryPipelines/${pipeline}/releases/${release}/rollouts`,
      'rollouts',
      { pageSize: 200 },
      400,
    );
    return list.map(mapRollout).sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
  }

  private track(
    h: ProfileHandle,
    projectId: string,
    location: string,
    pipeline: string,
    kind: string,
    name: string,
    displayName: string,
    response: unknown,
  ) {
    return this.restOps.track(h, {
      projectId,
      product: 'clouddeploy',
      kind,
      resource: { name, displayName, href: `/p/${projectId}/clouddeploy/${location}/${pipeline}` },
      root: CLOUDDEPLOY,
      response,
    });
  }

  async rolloutAction(
    h: ProfileHandle,
    projectId: string,
    location: string,
    pipeline: string,
    release: string,
    rollout: string,
    action: RolloutAction,
    b: RolloutActionBody,
  ) {
    const name = `projects/${projectId}/locations/${location}/deliveryPipelines/${pipeline}/releases/${release}/rollouts/${rollout}`;
    let body: Any = {};
    let verb: string = action;
    if (action === 'approve' || action === 'reject') {
      verb = 'approve';
      body = { approved: action === 'approve' };
    } else if (action === 'advance') {
      if (!b.phaseId) throw ProblemException.of('INVALID_ARGUMENT', 'Advancing needs the phase to advance to.');
      body = { phaseId: b.phaseId };
    } else if (action === 'retryJob') {
      if (!b.phaseId || !b.jobId) throw ProblemException.of('INVALID_ARGUMENT', 'Retrying needs the phase and the job.');
      body = { phaseId: b.phaseId, jobId: b.jobId };
    }
    const r = await rest(h, CLOUDDEPLOY).post(`${name}:${verb}`, body);
    return this.track(
      h,
      projectId,
      location,
      pipeline,
      `clouddeploy.rollout.${action}`,
      name,
      `${action[0]?.toUpperCase()}${action.slice(1)} rollout ${rollout}`,
      r,
    );
  }

  /** Promotes a release: a new rollout to the given target (SPEC-0007 D-13). */
  async promote(h: ProfileHandle, projectId: string, location: string, pipeline: string, release: string, targetId: string) {
    const parent = `projects/${projectId}/locations/${location}/deliveryPipelines/${pipeline}/releases/${release}`;
    const rolloutId = `${release}-to-${targetId}-${Date.now().toString(36)}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 63)
      .replace(/-+$/, '');
    const r = await rest(h, CLOUDDEPLOY).post(`${parent}/rollouts`, { targetId }, { rolloutId });
    return this.track(h, projectId, location, pipeline, 'clouddeploy.release.promote', parent, `Promote ${release} to ${targetId}`, r);
  }
}

const p = { schema: ProjectIdParamSchema };
const seg = { schema: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62})$/) };

@Controller('api/projects/:projectId/clouddeploy')
export class DeployController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly deploy: DeployService,
  ) {}

  private accepted(res: Response, operation: OperationAccepted['operation']): OperationAccepted {
    res.status(operation.family === 'instant' ? 200 : 202);
    return { operation };
  }

  @Get('pipelines')
  pipelines(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({
      schema: z.object({
        location: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .default('all'),
      }),
    })
    q: { location: string },
  ) {
    return this.deploy.pipelines(this.profiles.get(profileId), projectId, q.location);
  }

  @Get('targets')
  targets(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({
      schema: z.object({
        location: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .default('all'),
      }),
    })
    q: { location: string },
  ) {
    return this.deploy.targets(this.profiles.get(profileId), projectId, q.location);
  }

  @Get('pipelines/:location/:pipeline')
  pipeline(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', seg) location: string,
    @Param('pipeline', seg) pipeline: string,
  ) {
    return this.deploy.pipeline(this.profiles.get(profileId), projectId, location, pipeline);
  }

  @Get('pipelines/:location/:pipeline/releases')
  releases(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', seg) location: string,
    @Param('pipeline', seg) pipeline: string,
  ) {
    return this.deploy.releases(this.profiles.get(profileId), projectId, location, pipeline);
  }

  @Get('pipelines/:location/:pipeline/releases/:release/rollouts')
  rollouts(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', seg) location: string,
    @Param('pipeline', seg) pipeline: string,
    @Param('release', seg) release: string,
  ) {
    return this.deploy.rollouts(this.profiles.get(profileId), projectId, location, pipeline, release);
  }

  @Post('pipelines/:location/:pipeline/releases/:release/rollouts/:rollout/:action')
  @Mutation({
    product: 'clouddeploy',
    verb: 'rollout.:action',
    resource: 'projects/:projectId/deliveryPipelines/:pipeline/releases/:release/rollouts/:rollout',
  })
  async action(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', seg) location: string,
    @Param('pipeline', seg) pipeline: string,
    @Param('release', seg) release: string,
    @Param('rollout', seg) rollout: string,
    @Param('action', { schema: z.enum(rolloutActions) }) action: RolloutAction,
    @Body({ schema: RolloutActionSchema }) body: RolloutActionBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(
      res,
      await this.deploy.rolloutAction(this.profiles.get(profileId), projectId, location, pipeline, release, rollout, action, body),
    );
  }

  @Post('pipelines/:location/:pipeline/releases/:release/promote')
  @Mutation({
    product: 'clouddeploy',
    verb: 'release.promote',
    resource: 'projects/:projectId/deliveryPipelines/:pipeline/releases/:release',
  })
  async promote(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', seg) location: string,
    @Param('pipeline', seg) pipeline: string,
    @Param('release', seg) release: string,
    @Body({ schema: PromoteReleaseSchema }) body: { targetId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(
      res,
      await this.deploy.promote(this.profiles.get(profileId), projectId, location, pipeline, release, body.targetId),
    );
  }
}
