import {
  FunctionIdSchema,
  type FunctionUpgradeView,
  type OperationAccepted,
  ProjectIdParamSchema,
  RegionSchema,
  type UpgradeStep,
  type UpgradeStepBody,
  UpgradeStepSchema,
  upgradePlan,
  upgradeSteps,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Functions REST resources are read field by field.
type Any = any;

const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2/';

const METHOD: Record<UpgradeStep, string> = {
  setup: 'setupFunctionUpgradeConfig',
  redirect: 'redirectFunctionUpgradeTraffic',
  rollback: 'rollbackFunctionUpgradeTraffic',
  commit: 'commitFunctionUpgrade',
  abort: 'abortFunctionUpgrade',
};

const LABEL: Record<UpgradeStep, string> = {
  setup: 'Set up the 2nd gen copy of',
  redirect: 'Send traffic to the 2nd gen copy of',
  rollback: 'Send traffic back to',
  commit: 'Commit the upgrade of',
  abort: 'Abort the upgrade of',
};

export function upgradeView(f: Any): FunctionUpgradeView {
  const state = f?.environment === 'GEN_1' ? String(f?.upgradeInfo?.upgradeState ?? 'UPGRADE_STATE_UNSPECIFIED') : null;
  return { state, copyService: f?.upgradeInfo?.serviceConfig?.service ?? null, ...upgradePlan(state) };
}

/**
 * Upgrading a 1st gen function to Cloud Run functions, and detaching a function from the Functions
 * API (SPEC-0003 D-18). The methods exist only in REST; each step is a tracked operation.
 */
@Injectable()
export class FunctionUpgradeService {
  constructor(private readonly restOps: RestOperations) {}

  private async raw(h: ProfileHandle, name: string): Promise<Any> {
    return rest(h, FUNCTIONS).get<Any>(name);
  }

  async view(h: ProfileHandle, name: string): Promise<FunctionUpgradeView> {
    return upgradeView(await this.raw(h, name));
  }

  /** Runs one step, after checking the current state allows it. */
  async step(h: ProfileHandle, projectId: string, name: string, step: UpgradeStep, b: UpgradeStepBody) {
    const id = name.split('/').pop() ?? name;
    const view = upgradeView(await this.raw(h, name));
    if (!view.steps.includes(step)) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        view.blocked ?? `The function is ${view.state}; ${step} is not a next step from there.`,
      );
    }
    // Commit deletes the 1st gen function; abort deletes the 2nd gen copy.
    if (step === 'commit' || step === 'abort') requireConfirmation(b.confirm, id);
    const response = await rest(h, FUNCTIONS).post<Any>(
      `${name}:${METHOD[step]}`,
      step === 'setup' && b.triggerServiceAccount ? { triggerServiceAccount: b.triggerServiceAccount } : {},
    );
    return this.restOps.track(h, {
      projectId,
      product: 'functions',
      kind: `functions.upgrade.${step}`,
      resource: { name, displayName: `${LABEL[step]} ${id}`, href: `/p/${projectId}/functions/${name.split('/')[3]}/${id}` },
      root: FUNCTIONS,
      response,
    });
  }

  /** Detaches a 2nd gen function: it stays a Cloud Run service, no longer managed by the Functions API. */
  async detach(h: ProfileHandle, projectId: string, name: string) {
    const f = await this.raw(h, name);
    if (f?.environment === 'GEN_1')
      throw ProblemException.of('FAILED_PRECONDITION', 'A 1st gen function cannot be detached; upgrade it first.');
    const id = name.split('/').pop() ?? name;
    const response = await rest(h, FUNCTIONS).post<Any>(`${name}:detachFunction`, {});
    return this.restOps.track(h, {
      projectId,
      product: 'functions',
      kind: 'functions.function.detach',
      resource: { name, displayName: `Detach ${id}`, href: `/p/${projectId}/functions` },
      root: FUNCTIONS,
      response,
    });
  }
}

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const fid = { schema: FunctionIdSchema };
const FN = 'projects/:projectId/locations/:location/functions/:fn';
const fnName = (projectId: string, location: string, fn: string) => `projects/${projectId}/locations/${location}/functions/${fn}`;

@Controller('api/projects/:projectId/functions/locations/:location/functions/:fn')
export class FunctionUpgradeController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly upgrades: FunctionUpgradeService,
  ) {}

  @Get('upgrade')
  view(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
  ): Promise<FunctionUpgradeView> {
    return this.upgrades.view(this.profiles.get(profileId), fnName(projectId, location, fn));
  }

  @Post('upgrade/:step')
  @HttpCode(202)
  @Mutation({ product: 'functions', verb: 'function.upgrade.:step', resource: FN })
  async step(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
    @Param('step', { schema: z.enum(upgradeSteps) }) step: UpgradeStep,
    @Body({ schema: UpgradeStepSchema }) body: UpgradeStepBody,
  ): Promise<OperationAccepted> {
    return { operation: await this.upgrades.step(this.profiles.get(profileId), projectId, fnName(projectId, location, fn), step, body) };
  }

  @Post('detach')
  @HttpCode(202)
  @Mutation({ product: 'functions', verb: 'function.detach', resource: FN })
  async detach(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
    @Body({ schema: UpgradeStepSchema }) body: UpgradeStepBody,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, fn);
    return { operation: await this.upgrades.detach(this.profiles.get(profileId), projectId, fnName(projectId, location, fn)) };
  }
}
