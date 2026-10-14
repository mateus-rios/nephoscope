import {
  ApproveBuildSchema,
  BUILD_DONE,
  type BuildDetail,
  type BuildListQuery,
  BuildListQuerySchema,
  type BuildLogsMessage,
  type BuildLogsParams,
  BuildLogsParamsSchema,
  type BuildStepView,
  type BuildSummary,
  type Confirm,
  ConfirmSchema,
  GCP_REGIONS,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type RunTrigger,
  RunTriggerSchema,
  type SaveTrigger,
  SaveTriggerSchema,
  type TriggerView,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import type { LiveChannelProvider } from '../../core/live/live.types.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Cloud Build REST resources are read field by field.
type Any = any;

export const CLOUDBUILD = 'https://cloudbuild.googleapis.com/v1/';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (n: string) => n.split('/').pop() ?? n;

function sourceText(b: Any): string | null {
  const s = b?.source;
  const prov = b?.sourceProvenance?.resolvedRepoSource ?? s?.repoSource;
  if (prov?.repoName)
    return `${prov.repoName}${prov.branchName ? `@${prov.branchName}` : prov.tagName ? `@${prov.tagName}` : ''}${prov.commitSha ? ` ${String(prov.commitSha).slice(0, 7)}` : ''}`;
  if (s?.gitSource?.url) return `${s.gitSource.url}${s.gitSource.revision ? `@${s.gitSource.revision}` : ''}`;
  if (s?.storageSource?.bucket) return `gs://${s.storageSource.bucket}/${s.storageSource.object ?? ''}`;
  if (b?.substitutions?.REPO_NAME) return `${b.substitutions.REPO_NAME}@${b.substitutions.BRANCH_NAME ?? b.substitutions.TAG_NAME ?? ''}`;
  return null;
}

export function mapBuild(b: Any): BuildSummary {
  const name = String(b?.name ?? '');
  return {
    name,
    id: String(b?.id ?? short(name)),
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? 'global',
    status: String(b?.status ?? 'STATUS_UNKNOWN'),
    createTime: str(b?.createTime),
    startTime: str(b?.startTime),
    finishTime: str(b?.finishTime),
    triggerId: str(b?.buildTriggerId),
    source: sourceText(b),
    tags: ((b?.tags ?? []) as Any[]).map(String),
    images: ((b?.images ?? []) as Any[]).map(String),
    failure: str(b?.failureInfo?.detail) ?? (b?.status === 'FAILURE' ? str(b?.statusDetail) : null),
    approval: str(b?.approval?.state),
  };
}

export function mapBuildDetail(b: Any): BuildDetail {
  const steps: BuildStepView[] = ((b?.steps ?? []) as Any[]).map((s) => ({
    id: str(s?.id),
    name: String(s?.name ?? ''),
    args: ((s?.args ?? []) as Any[]).map(String),
    entrypoint: str(s?.entrypoint),
    status: String(s?.status ?? 'STATUS_UNKNOWN'),
    startTime: str(s?.timing?.startTime),
    endTime: str(s?.timing?.endTime),
  }));
  return {
    ...mapBuild(b),
    steps,
    substitutions: (b?.substitutions ?? {}) as Record<string, string>,
    serviceAccount: str(b?.serviceAccount),
    logsBucket: str(b?.logsBucket),
    logging: str(b?.options?.logging),
    timeout: str(b?.timeout),
    raw: b,
  };
}

export function mapTrigger(t: Any): TriggerView {
  const name = String(t?.resourceName ?? t?.name ?? '');
  const gh = t?.github;
  const rs = t?.repositoryEventConfig;
  const event: TriggerView['event'] = t?.pubsubConfig
    ? 'pubsub'
    : t?.webhookConfig
      ? 'webhook'
      : gh?.pullRequest || rs?.pullRequest || t?.triggerTemplate?.pullRequest
        ? 'pull_request'
        : gh?.push || rs?.push || t?.triggerTemplate
          ? 'push'
          : t?.sourceToBuild
            ? 'manual'
            : 'other';
  const push = gh?.push ?? rs?.push ?? t?.triggerTemplate ?? {};
  const pr = gh?.pullRequest ?? rs?.pullRequest ?? {};
  return {
    name,
    id: String(t?.id ?? ''),
    triggerName: String(t?.name ?? ''),
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? 'global',
    description: str(t?.description),
    disabled: !!t?.disabled,
    event,
    repo: gh ? `${gh.owner}/${gh.name}` : (str(rs?.repository) ?? str(t?.triggerTemplate?.repoName) ?? str(t?.sourceToBuild?.uri)),
    branch: str(push.branch) ?? str(pr.branch),
    tag: str(push.tag),
    filename: str(t?.filename) ?? (t?.build ? 'inline build' : null),
    createTime: str(t?.createTime),
  };
}

/** The filter of a builds list from the page's controls. */
export function buildFilter(q: Pick<BuildListQuery, 'status' | 'trigger' | 'tag'>): string | undefined {
  const parts = [
    q.status ? `status="${q.status}"` : '',
    q.trigger ? `trigger_id="${q.trigger}"` : '',
    q.tag ? `tags="${q.tag}"` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' AND ') : undefined;
}

/** `gs://bucket/path` and a build id to the log object (SPEC-0007 D-12). */
export function logObject(logsBucket: string, buildId: string): { bucket: string; object: string } | null {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(logsBucket);
  if (!m) return null;
  const prefix = (m[2] ?? '').replace(/\/+$/, '');
  return { bucket: m[1] as string, object: `${prefix ? `${prefix}/` : ''}log-${buildId}.txt` };
}

/** Cloud Build through REST (SPEC-0007 D-12). */
@Injectable()
export class BuildService {
  constructor(private readonly restOps: RestOperations) {}

  private buildName(projectId: string, location: string, id: string) {
    return `projects/${projectId}/locations/${location}/builds/${id}`;
  }

  async list(h: ProfileHandle, projectId: string, q: BuildListQuery): Promise<ListResponse<BuildSummary>> {
    const client = rest(h, CLOUDBUILD);
    const filter = buildFilter(q);
    const one = async (loc: string, pageToken?: string) =>
      client.page<Any>(`projects/${projectId}/locations/${loc}/builds`, 'builds', { pageSize: 100, filter, pageToken });
    if (q.location !== 'all') {
      const page = await one(q.location, q.pageToken);
      return { items: page.items.map(mapBuild), nextPageToken: page.next };
    }
    const r = await fanOut(['global', ...GCP_REGIONS], async (loc) => (await one(loc)).items.map(mapBuild));
    r.items.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
    return r;
  }

  async get(h: ProfileHandle, projectId: string, location: string, id: string): Promise<BuildDetail> {
    return mapBuildDetail(await rest(h, CLOUDBUILD).get(this.buildName(projectId, location, id)));
  }

  private track(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, response: unknown) {
    return this.restOps.track(h, {
      projectId,
      product: 'cloudbuild',
      kind,
      resource: { name, displayName, href: `/p/${projectId}/cloudbuild` },
      root: CLOUDBUILD,
      response,
    });
  }

  async retry(h: ProfileHandle, projectId: string, location: string, id: string) {
    const r = await rest(h, CLOUDBUILD).post(`${this.buildName(projectId, location, id)}:retry`, {
      name: this.buildName(projectId, location, id),
    });
    return this.track(h, projectId, 'cloudbuild.build.retry', this.buildName(projectId, location, id), `Retry build ${id.slice(0, 8)}`, r);
  }

  async cancel(h: ProfileHandle, projectId: string, location: string, id: string) {
    const r = await rest(h, CLOUDBUILD).post(`${this.buildName(projectId, location, id)}:cancel`, {
      name: this.buildName(projectId, location, id),
    });
    return this.track(
      h,
      projectId,
      'cloudbuild.build.cancel',
      this.buildName(projectId, location, id),
      `Cancel build ${id.slice(0, 8)}`,
      r,
    );
  }

  async approve(h: ProfileHandle, projectId: string, location: string, id: string, decision: 'APPROVED' | 'REJECTED', comment: string) {
    const r = await rest(h, CLOUDBUILD).post(`${this.buildName(projectId, location, id)}:approve`, {
      approvalResult: { decision, comment },
    });
    return this.track(
      h,
      projectId,
      `cloudbuild.build.${decision === 'APPROVED' ? 'approve' : 'reject'}`,
      this.buildName(projectId, location, id),
      `${decision === 'APPROVED' ? 'Approve' : 'Reject'} build ${id.slice(0, 8)}`,
      r,
    );
  }

  async triggers(h: ProfileHandle, projectId: string, location: string): Promise<ListResponse<TriggerView>> {
    const client = rest(h, CLOUDBUILD);
    const one = async (loc: string) =>
      (await client.all<Any>(`projects/${projectId}/locations/${loc}/triggers`, 'triggers', { pageSize: 100 })).map(mapTrigger);
    if (location !== 'all') return { items: await one(location), nextPageToken: null };
    return fanOut(['global', ...GCP_REGIONS], one);
  }

  async getTrigger(h: ProfileHandle, projectId: string, location: string, id: string): Promise<unknown> {
    return rest(h, CLOUDBUILD).get(`projects/${projectId}/locations/${location}/triggers/${id}`);
  }

  async runTrigger(h: ProfileHandle, projectId: string, location: string, id: string, b: RunTrigger) {
    const source: Any = { projectId, substitutions: b.substitutions };
    if (b.ref.kind === 'branch') source.branchName = b.ref.value;
    else if (b.ref.kind === 'tag') source.tagName = b.ref.value;
    else source.commitSha = b.ref.value;
    const name = `projects/${projectId}/locations/${location}/triggers/${id}`;
    const r = await rest(h, CLOUDBUILD).post(`${name}:run`, { name, source });
    return this.track(h, projectId, 'cloudbuild.trigger.run', name, `Run trigger ${id.slice(0, 8)}`, r);
  }

  async setTriggerDisabled(h: ProfileHandle, projectId: string, location: string, id: string, disabled: boolean) {
    const name = `projects/${projectId}/locations/${location}/triggers/${id}`;
    const current = await rest(h, CLOUDBUILD).get<Any>(name);
    const r = await rest(h, CLOUDBUILD).patch(name, { ...current, disabled }, { updateMask: 'disabled' });
    return this.track(
      h,
      projectId,
      `cloudbuild.trigger.${disabled ? 'disable' : 'enable'}`,
      name,
      `${disabled ? 'Disable' : 'Enable'} trigger ${current?.name ?? id}`,
      r,
    );
  }

  async saveTrigger(h: ProfileHandle, projectId: string, b: SaveTrigger, id?: string) {
    let trigger: Any;
    try {
      trigger = JSON.parse(b.json);
    } catch (err) {
      throw ProblemException.of('INVALID_ARGUMENT', `The trigger is not valid JSON: ${(err as Error).message}`);
    }
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger))
      throw ProblemException.of('INVALID_ARGUMENT', 'The trigger must be a JSON object.');
    const parent = `projects/${projectId}/locations/${b.location}/triggers`;
    const r = id ? await rest(h, CLOUDBUILD).patch(`${parent}/${id}`, trigger) : await rest(h, CLOUDBUILD).post(parent, trigger);
    return this.track(
      h,
      projectId,
      `cloudbuild.trigger.${id ? 'update' : 'create'}`,
      `${parent}/${id ?? trigger.name}`,
      `${id ? 'Update' : 'Create'} trigger ${trigger.name ?? ''}`,
      r,
    );
  }

  async deleteTrigger(h: ProfileHandle, projectId: string, location: string, id: string) {
    const name = `projects/${projectId}/locations/${location}/triggers/${id}`;
    const r = await rest(h, CLOUDBUILD).delete(name);
    return this.track(h, projectId, 'cloudbuild.trigger.delete', name, `Delete trigger ${id.slice(0, 8)}`, r);
  }
}

/**
 * `build.logs`: the build's log object in Cloud Storage, read from the last offset every 2 s until
 * the build ends (SPEC-0007 D-12, NFR-02).
 */
export function buildLogsChannel(): LiveChannelProvider<BuildLogsParams> {
  return {
    channel: 'build.logs',
    params: BuildLogsParamsSchema,
    open(ctx, sink) {
      let stopped = false;
      let offset = 0;
      let timer: NodeJS.Timeout | null = null;
      const projectId = ctx.projectId ?? '';
      const tick = async () => {
        if (stopped) return;
        try {
          const b = await rest(ctx.profile, CLOUDBUILD).get<Any>(
            `projects/${projectId}/locations/${ctx.params.location}/builds/${ctx.params.buildId}`,
          );
          const status = String(b?.status ?? 'STATUS_UNKNOWN');
          const done = BUILD_DONE.includes(status);
          let text = '';
          const obj = b?.logsBucket ? logObject(String(b.logsBucket), ctx.params.buildId) : null;
          if (obj) {
            try {
              text = await rest(ctx.profile, '').call<string>(
                `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(obj.bucket)}/o/${encodeURIComponent(obj.object)}`,
                {
                  query: { alt: 'media' },
                  headers: { Range: `bytes=${offset}-` },
                  responseType: 'text',
                },
              );
            } catch (err) {
              // 404: not written yet; 416: nothing new since the offset.
              const status = (err as Any)?.response?.status;
              if (status !== 404 && status !== 416) throw err;
            }
          }
          offset += Buffer.byteLength(text ?? '', 'utf8');
          if (text || done) sink.data({ text: text ?? '', status, done } satisfies BuildLogsMessage);
          if (done) {
            sink.end();
            return;
          }
        } catch (err) {
          sink.error(toProblem(err));
          return;
        }
        if (!stopped) timer = setTimeout(() => void tick(), 2000);
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

const p = { schema: ProjectIdParamSchema };
const loc = { schema: z.string().regex(/^[a-z0-9-]{1,64}$/) };
const buildId = { schema: z.string().regex(/^[0-9a-f-]{36}$/) };
const triggerId = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) };

@Controller('api/projects/:projectId/cloudbuild')
export class BuildController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly builds: BuildService,
  ) {}

  private accepted(res: Response, operation: OperationAccepted['operation']): OperationAccepted {
    res.status(operation.family === 'instant' ? 200 : 202);
    return { operation };
  }

  @Get('builds')
  list(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: BuildListQuerySchema }) q: BuildListQuery,
  ) {
    return this.builds.list(this.profiles.get(profileId), projectId, q);
  }

  @Get('builds/:location/:build')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('build', buildId) id: string,
  ) {
    return this.builds.get(this.profiles.get(profileId), projectId, location, id);
  }

  @Post('builds/:location/:build/retry')
  @Mutation({ product: 'cloudbuild', verb: 'build.retry', resource: 'projects/:projectId/builds/:build' })
  async retry(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('build', buildId) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.retry(this.profiles.get(profileId), projectId, location, id));
  }

  @Post('builds/:location/:build/cancel')
  @Mutation({ product: 'cloudbuild', verb: 'build.cancel', resource: 'projects/:projectId/builds/:build' })
  async cancel(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('build', buildId) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.cancel(this.profiles.get(profileId), projectId, location, id));
  }

  @Post('builds/:location/:build/approve')
  @Mutation({ product: 'cloudbuild', verb: 'build.approve', resource: 'projects/:projectId/builds/:build' })
  async approve(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('build', buildId) id: string,
    @Body({ schema: ApproveBuildSchema }) body: { decision: 'APPROVED' | 'REJECTED'; comment: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(
      res,
      await this.builds.approve(this.profiles.get(profileId), projectId, location, id, body.decision, body.comment),
    );
  }

  @Get('triggers')
  triggers(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({
      schema: z.object({
        location: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .default('global'),
      }),
    })
    q: { location: string },
  ) {
    return this.builds.triggers(this.profiles.get(profileId), projectId, q.location);
  }

  @Get('triggers/:location/:trigger')
  trigger(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', triggerId) id: string,
  ) {
    return this.builds.getTrigger(this.profiles.get(profileId), projectId, location, id);
  }

  @Post('triggers/:location/:trigger/run')
  @Mutation({ product: 'cloudbuild', verb: 'trigger.run', resource: 'projects/:projectId/triggers/:trigger' })
  async run(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', triggerId) id: string,
    @Body({ schema: RunTriggerSchema }) body: RunTrigger,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.runTrigger(this.profiles.get(profileId), projectId, location, id, body));
  }

  @Patch('triggers/:location/:trigger/state')
  @Mutation({ product: 'cloudbuild', verb: 'trigger.state', resource: 'projects/:projectId/triggers/:trigger' })
  async setState(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', triggerId) id: string,
    @Body({ schema: z.object({ disabled: z.boolean() }) }) body: { disabled: boolean },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.setTriggerDisabled(this.profiles.get(profileId), projectId, location, id, body.disabled));
  }

  @Post('triggers')
  @Mutation({ product: 'cloudbuild', verb: 'trigger.create', resource: 'projects/:projectId/triggers' })
  async create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SaveTriggerSchema }) body: SaveTrigger,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.saveTrigger(this.profiles.get(profileId), projectId, body));
  }

  @Put('triggers/:location/:trigger')
  @Mutation({ product: 'cloudbuild', verb: 'trigger.update', resource: 'projects/:projectId/triggers/:trigger' })
  async update(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', triggerId) id: string,
    @Body({ schema: SaveTriggerSchema }) body: SaveTrigger,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accepted(res, await this.builds.saveTrigger(this.profiles.get(profileId), projectId, { ...body, location }, id));
  }

  @Delete('triggers/:location/:trigger')
  @HttpCode(200)
  @Mutation({ product: 'cloudbuild', verb: 'trigger.delete', resource: 'projects/:projectId/triggers/:trigger' })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('trigger', triggerId) id: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireConfirmation(body.confirm, id);
    return this.accepted(res, await this.builds.deleteTrigger(this.profiles.get(profileId), projectId, location, id));
  }
}
