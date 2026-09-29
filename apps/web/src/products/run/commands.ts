import type { DeployService, EnvVar, ExecuteJob, TrafficTarget } from '@nephoscope/contracts';
import type { Equivalent } from '../../kit/EquivalentCommand';
import { sh } from '../../kit/EquivalentCommand';

const CONTINUATION = ' \\\n  ';

/** "gcloud run deploy x" on one line, then one flag per continued line. */
export function multiline(head: string[], flags: string[]): string {
  return flags.length === 0 ? head.join(' ') : `${head.join(' ')}${CONTINUATION}${flags.join(CONTINUATION)}`;
}

const ingressFlag = { ALL: 'all', INTERNAL_ONLY: 'internal', INTERNAL_LOAD_BALANCER: 'internal-and-cloud-load-balancing' } as const;

function envFlags(env: EnvVar[] | undefined): string[] {
  if (!env) return [];
  const plain = env.filter((e) => !e.secret);
  const secrets = env.filter((e) => e.secret);
  const out: string[] = [];
  // ^@^ picks a delimiter that values are unlikely to contain (gcloud topic escaping).
  if (plain.length > 0) out.push(`--set-env-vars=${sh(`^@^${plain.map((e) => `${e.name}=${e.value ?? ''}`).join('@')}`)}`);
  else out.push('--clear-env-vars');
  if (secrets.length > 0)
    out.push(`--set-secrets=${sh(secrets.map((e) => `${e.name}=${e.secret?.secret}:${e.secret?.version}`).join(','))}`);
  return out;
}

/** `gcloud run deploy` and the REST call for the deploy and create forms (SPEC-0001 CA-65). */
export function deployCommand(projectId: string, region: string, service: string, d: DeployService, create: boolean): Equivalent {
  const parts = [`--project=${projectId}`, `--region=${region}`];
  const c = d.container;
  if (c.image) parts.push(`--image=${sh(c.image)}`);
  if (c.port !== undefined && c.port !== null) parts.push(`--port=${c.port}`);
  if (c.command !== undefined) parts.push(c.command.length ? `--command=${sh(c.command.join(','))}` : '--command=""');
  if (c.args !== undefined) parts.push(c.args.length ? `--args=${sh(c.args.join(','))}` : '--args=""');
  parts.push(...envFlags(c.env));
  if (c.cpu) parts.push(`--cpu=${c.cpu}`);
  if (c.memory) parts.push(`--memory=${c.memory}`);
  if (c.cpuIdle !== undefined) parts.push(c.cpuIdle ? '--cpu-throttling' : '--no-cpu-throttling');
  if (c.startupCpuBoost !== undefined) parts.push(c.startupCpuBoost ? '--cpu-boost' : '--no-cpu-boost');
  if (d.minInstances !== undefined) parts.push(`--min-instances=${d.minInstances ?? 'default'}`);
  if (d.maxInstances !== undefined) parts.push(`--max-instances=${d.maxInstances ?? 'default'}`);
  if (d.concurrency !== undefined) parts.push(`--concurrency=${d.concurrency}`);
  if (d.timeoutSeconds !== undefined) parts.push(`--timeout=${d.timeoutSeconds}s`);
  if (d.executionEnvironment && d.executionEnvironment !== 'UNSPECIFIED')
    parts.push(`--execution-environment=${d.executionEnvironment.toLowerCase()}`);
  if (d.serviceAccount !== undefined && d.serviceAccount) parts.push(`--service-account=${d.serviceAccount}`);
  if (d.ingress) parts.push(`--ingress=${ingressFlag[d.ingress]}`);
  if (d.vpc === null) parts.push('--clear-vpc-connector', '--clear-network');
  else if (d.vpc?.connector) parts.push(`--vpc-connector=${d.vpc.connector}`);
  else if (d.vpc?.network || d.vpc?.subnetwork) {
    if (d.vpc.network) parts.push(`--network=${d.vpc.network}`);
    if (d.vpc.subnetwork) parts.push(`--subnet=${d.vpc.subnetwork}`);
  }
  if (d.vpc?.egress) parts.push(`--vpc-egress=${d.vpc.egress === 'ALL_TRAFFIC' ? 'all-traffic' : 'private-ranges-only'}`);
  if (d.labels !== undefined) {
    const labels = Object.entries(d.labels);
    parts.push(labels.length ? `--labels=${sh(labels.map(([k, v]) => `${k}=${v}`).join(','))}` : '--clear-labels');
  }
  if (d.revisionSuffix) parts.push(`--revision-suffix=${d.revisionSuffix}`);
  if (!create && !d.serveImmediately) parts.push('--no-traffic');
  const name = `projects/${projectId}/locations/${region}/services/${service}`;
  return {
    gcloud: multiline(['gcloud', 'run', 'deploy', service], parts),
    rest: create
      ? {
          method: 'POST',
          url: `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services?serviceId=${service}`,
          body: { template: { containers: [{ image: c.image }] } },
        }
      : {
          method: 'PATCH',
          url: `https://run.googleapis.com/v2/${name}`,
          body: { note: 'The whole current service is sent back with only the edited fields changed.' },
        },
  };
}

export function trafficCommand(projectId: string, region: string, service: string, traffic: TrafficTarget[]): Equivalent {
  const toRevisions = traffic
    .filter((t) => t.percent > 0 || t.type === 'LATEST')
    .map((t) => `${t.type === 'LATEST' ? 'LATEST' : t.revision}=${t.percent}`)
    .join(',');
  const tags = traffic.filter((t) => t.tag && t.revision).map((t) => `${t.tag}=${t.revision}`);
  const parts = [`--project=${projectId}`, `--region=${region}`, `--to-revisions=${toRevisions}`];
  if (tags.length > 0) parts.push(`--set-tags=${tags.join(',')}`);
  return {
    gcloud: multiline(['gcloud', 'run', 'services', 'update-traffic', service], parts),
    rest: {
      method: 'PATCH',
      url: `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${service}`,
      body: {
        traffic: traffic.map((t) =>
          t.type === 'LATEST'
            ? { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: t.percent, tag: t.tag ?? undefined }
            : { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: t.revision, percent: t.percent, tag: t.tag ?? undefined },
        ),
      },
    },
  };
}

export function executeCommand(projectId: string, region: string, job: string, e: ExecuteJob): Equivalent {
  const parts = [`--project=${projectId}`, `--region=${region}`];
  if (e.args !== undefined) parts.push(`--args=${sh(e.args.join(','))}`);
  if (e.env && e.env.length > 0) parts.push(`--update-env-vars=${sh(`^@^${e.env.map((v) => `${v.name}=${v.value}`).join('@')}`)}`);
  if (e.taskCount !== undefined) parts.push(`--tasks=${e.taskCount}`);
  if (e.timeoutSeconds !== undefined) parts.push(`--task-timeout=${e.timeoutSeconds}s`);
  const overrides: Record<string, unknown> = {};
  if (e.args !== undefined || e.env) overrides.containerOverrides = [{ args: e.args, env: e.env }];
  if (e.taskCount !== undefined) overrides.taskCount = e.taskCount;
  if (e.timeoutSeconds !== undefined) overrides.timeout = `${e.timeoutSeconds}s`;
  return {
    gcloud: multiline(['gcloud', 'run', 'jobs', 'execute', job], parts),
    rest: {
      method: 'POST',
      url: `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${job}:run`,
      body: Object.keys(overrides).length ? { overrides } : {},
    },
  };
}
