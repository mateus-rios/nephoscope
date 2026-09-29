import type {
  CreateWorkflow,
  DeployWorkflow,
  ExecuteWorkflow,
  ListResponse,
  OperationSummary,
  StepEntry,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionUpdate,
  WorkflowRevision,
  WorkflowSummary,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { lroPoller, type OperationLike, operationGetter } from '../../core/gcp/lro.js';
import { rawJson } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService, type Poller } from '../../core/operations/operations.service.js';
import { HistoryService } from '../../core/store/history.service.js';
import { mapExecution, mapRevision, mapStepEntry, mapWorkflow, mapWorkflowSummary } from './workflows-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: generated messages are passed through.
type Any = any;

const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const shortName = (name: string) => name.split('/').pop() ?? name;

export function workflowHref(name: string): string {
  const execution = /\/executions\/([^/]+)$/.exec(name)?.[1];
  const workflow = name.replace(/\/executions\/[^/]+$/, '');
  const base = `/p/${projectOf(name)}/workflows/${locationOf(name)}/${shortName(workflow)}`;
  return execution ? `${base}/executions/${execution}` : base;
}

type Kind = 'workflows.workflow.create' | 'workflows.workflow.deploy' | 'workflows.workflow.delete';

/** Workflows (SPEC-0003 D-10, D-11, CA-18 to CA-22). */
@Injectable()
export class WorkflowsService {
  private readonly wildcard = new WildcardSupport();

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
    private readonly history: HistoryService,
  ) {
    for (const kind of ['workflows.workflow.create', 'workflows.workflow.deploy', 'workflows.workflow.delete'] as const) {
      this.operations.registerResumer(kind, (op) => (op.googleName ? this.poller(op.profileId, op.googleName) : null));
    }
  }

  private async workflows(profileId: string) {
    const { WorkflowsClient } = await sdk.workflows();
    return this.clients.get(profileId, 'workflows', (auth) => new WorkflowsClient({ auth }));
  }

  private async executions(profileId: string) {
    const { ExecutionsClient } = await sdk.workflows();
    return this.clients.get(profileId, 'workflows.executions', (auth) => new ExecutionsClient({ auth }));
  }

  private async rest(profileId: string) {
    const { workflowexecutions } = await sdk.workflowExecutionsRest();
    return this.clients.get(profileId, 'workflowexecutions.rest', (auth) => workflowexecutions({ version: 'v1', auth: auth as never }));
  }

  private poller(profileId: string, googleName: string): Poller {
    return lroPoller(async (name) => operationGetter((await this.workflows(profileId)) as never)(name), googleName);
  }

  private track(h: ProfileHandle, kind: Kind, name: string, displayName: string, op: OperationLike): OperationSummary {
    const googleName = op.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'workflows',
      kind,
      family: 'longrunning',
      googleName,
      resource: { name, displayName, href: workflowHref(name) },
      poll: googleName ? this.poller(h.profile.id, googleName) : async () => ({ done: true }),
    });
  }

  /** Tries `locations/-` once, then lists every Workflows location (SPEC-0003 D-11, SPEC-0001 D-17). */
  async list(h: ProfileHandle, projectId: string): Promise<ListResponse<WorkflowSummary>> {
    const client = await this.workflows(h.profile.id);
    const inLocation = async (location: string) => {
      const [items] = await client.listWorkflows({ parent: `projects/${projectId}/locations/${location}`, pageSize: 1000 });
      return items.map(mapWorkflowSummary);
    };
    const result = await this.wildcard.list(
      'workflows',
      async () => ({ items: await inLocation('-'), nextPageToken: null }),
      async () => {
        const locations: string[] = [];
        for await (const l of client.listLocationsAsync({ name: `projects/${projectId}` })) if (l.locationId) locations.push(l.locationId);
        return fanOut(locations, inLocation);
      },
    );
    result.items.sort((a, b) => a.id.localeCompare(b.id) || a.location.localeCompare(b.location));
    return result;
  }

  async get(h: ProfileHandle, name: string): Promise<Workflow> {
    const [w] = await (await this.workflows(h.profile.id)).getWorkflow({ name });
    return mapWorkflow(w);
  }

  async raw(h: ProfileHandle, name: string): Promise<unknown> {
    const [w] = await (await this.workflows(h.profile.id)).getWorkflow({ name });
    return rawJson(w);
  }

  async revisions(h: ProfileHandle, name: string): Promise<WorkflowRevision[]> {
    const [items] = await (await this.workflows(h.profile.id)).listWorkflowRevisions({ name, pageSize: 100 }, { autoPaginate: false });
    return items.map(mapRevision);
  }

  private body(d: DeployWorkflow): { workflow: Any; paths: string[] } {
    const workflow: Any = { sourceContents: d.sourceContents };
    const paths = ['source_contents'];
    if (d.description !== undefined) {
      workflow.description = d.description;
      paths.push('description');
    }
    if (d.serviceAccount !== undefined) {
      workflow.serviceAccount = d.serviceAccount ?? '';
      paths.push('service_account');
    }
    if (d.callLogLevel !== undefined) {
      workflow.callLogLevel = d.callLogLevel;
      paths.push('call_log_level');
    }
    if (d.executionHistoryLevel !== undefined) {
      workflow.executionHistoryLevel = d.executionHistoryLevel;
      paths.push('execution_history_level');
    }
    if (d.labels !== undefined) {
      workflow.labels = d.labels;
      paths.push('labels');
    }
    if (d.userEnvVars !== undefined) {
      workflow.userEnvVars = d.userEnvVars;
      paths.push('user_env_vars');
    }
    return { workflow, paths };
  }

  /** Deploy creates a new revision as an operation (SPEC-0003 D-10). */
  async deploy(h: ProfileHandle, name: string, d: DeployWorkflow): Promise<OperationSummary> {
    const { workflow, paths } = this.body(d);
    const [op] = await (await this.workflows(h.profile.id)).updateWorkflow({ workflow: { ...workflow, name }, updateMask: { paths } });
    return this.track(h, 'workflows.workflow.deploy', name, `Deploy ${shortName(name)}`, op);
  }

  async create(h: ProfileHandle, projectId: string, d: CreateWorkflow): Promise<OperationSummary> {
    const { workflow } = this.body(d);
    const [op] = await (await this.workflows(h.profile.id)).createWorkflow({
      parent: `projects/${projectId}/locations/${d.region}`,
      workflowId: d.id,
      workflow,
    });
    return this.track(
      h,
      'workflows.workflow.create',
      `projects/${projectId}/locations/${d.region}/workflows/${d.id}`,
      `Create ${d.id}`,
      op,
    );
  }

  async remove(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.workflows(h.profile.id)).deleteWorkflow({ name });
    return this.track(h, 'workflows.workflow.delete', name, `Delete ${shortName(name)}`, op);
  }

  async listExecutions(h: ProfileHandle, workflow: string, pageToken?: string): Promise<ListResponse<WorkflowExecution>> {
    const [items, , response] = await (await this.executions(h.profile.id)).listExecutions(
      { parent: workflow, pageSize: 100, pageToken, view: 'BASIC' },
      { autoPaginate: false },
    );
    return { items: items.map(mapExecution), nextPageToken: response?.nextPageToken || null };
  }

  async getExecution(h: ProfileHandle, name: string): Promise<WorkflowExecution> {
    const [e] = await (await this.executions(h.profile.id)).getExecution({ name, view: 'FULL' });
    return mapExecution(e);
  }

  /** Execute with an argument, remembered for next time (SPEC-0003 D-11, CA-21). */
  async execute(h: ProfileHandle, workflow: string, body: ExecuteWorkflow): Promise<WorkflowExecution> {
    const execution: Any = {};
    if (body.argument.trim()) execution.argument = body.argument;
    if (body.callLogLevel) execution.callLogLevel = body.callLogLevel;
    if (body.historyLevel) execution.executionHistoryLevel = body.historyLevel;
    const [e] = await (await this.executions(h.profile.id)).createExecution({ parent: workflow, execution });
    if (body.argument.trim()) await this.history.add(`workflows.args:${workflow}`, body.argument);
    const mapped = mapExecution(e);
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId: projectOf(workflow),
      product: 'workflows',
      kind: 'workflows.execution.create',
      resource: { name: mapped.name, displayName: `Execute ${shortName(workflow)}`, href: workflowHref(mapped.name) },
    });
    return mapped;
  }

  async cancel(h: ProfileHandle, name: string): Promise<WorkflowExecution> {
    const [e] = await (await this.executions(h.profile.id)).cancelExecution({ name });
    return mapExecution(e);
  }

  /** Step entries come from the REST API; the gRPC client has none (SPEC-0003 D-11). */
  async stepEntries(h: ProfileHandle, execution: string, detailed: boolean): Promise<StepEntry[]> {
    const client = await this.rest(h.profile.id);
    const entries: StepEntry[] = [];
    let pageToken: string | undefined;
    do {
      const res = await client.projects.locations.workflows.executions.stepEntries.list({
        parent: execution,
        pageSize: 1000,
        pageToken,
        orderBy: 'entryId',
        view: detailed ? 'EXECUTION_ENTRY_VIEW_DETAILED' : 'EXECUTION_ENTRY_VIEW_BASIC',
      });
      entries.push(...(res.data.stepEntries ?? []).map(mapStepEntry));
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken && entries.length < 10_000);
    return entries;
  }

  async snapshot(h: ProfileHandle, name: string): Promise<WorkflowExecutionUpdate> {
    const execution = await this.getExecution(h, name);
    const steps = await this.stepEntries(h, name, execution.historyLevel === 'EXECUTION_HISTORY_DETAILED').catch(() => []);
    return { execution, steps };
  }
}
