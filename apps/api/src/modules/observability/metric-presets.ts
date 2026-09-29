import type { MetricPresetKind, MetricUnit } from '@nephoscope/contracts';

/** How a chart turns raw series into lines (SPEC-0005 D-07). */
export type ChartAggregation =
  /** Counters: per-second rate summed across series, split by `groupBy`. */
  | { kind: 'rate'; groupBy: string[] }
  /** Delta counters: count per alignment period summed across series, split by `groupBy`. */
  | { kind: 'sum'; groupBy: string[] }
  /** Distributions: one line per percentile across all series. */
  | { kind: 'percentiles'; percentiles: (50 | 95 | 99)[] }
  /** Gauges: maximum per period summed across series, split by `groupBy`. */
  | { kind: 'max'; groupBy: string[] };

export interface ChartPreset {
  id: string;
  title: string;
  metricType: string;
  unit: MetricUnit;
  aggregation: ChartAggregation;
}

export interface Preset {
  resourceType: string;
  /** Monitored resource labels the query must receive. */
  labels: string[];
  charts: ChartPreset[];
}

const p = (percentiles: (50 | 95 | 99)[]) => ({ kind: 'percentiles', percentiles }) as const;

/** SPEC-0005 §7.4, the M1 rows. */
export const METRIC_PRESETS: Record<MetricPresetKind, Preset> = {
  'run-service': {
    resourceType: 'cloud_run_revision',
    labels: ['service_name', 'location'],
    charts: [
      {
        id: 'requests',
        title: 'Requests per second',
        metricType: 'run.googleapis.com/request_count',
        unit: '1/s',
        aggregation: { kind: 'rate', groupBy: ['metric.label.response_code_class'] },
      },
      {
        id: 'latency',
        title: 'Request latency',
        metricType: 'run.googleapis.com/request_latencies',
        unit: 'ms',
        aggregation: p([50, 95, 99]),
      },
      {
        id: 'instances',
        title: 'Instances',
        metricType: 'run.googleapis.com/container/instance_count',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: ['metric.label.state'] },
      },
      {
        id: 'cpu',
        title: 'CPU utilization',
        metricType: 'run.googleapis.com/container/cpu/utilizations',
        unit: 'ratio',
        aggregation: p([50, 99]),
      },
      {
        id: 'memory',
        title: 'Memory utilization',
        metricType: 'run.googleapis.com/container/memory/utilizations',
        unit: 'ratio',
        aggregation: p([50, 99]),
      },
      {
        id: 'billable',
        title: 'Billable instance time',
        metricType: 'run.googleapis.com/container/billable_instance_time',
        unit: 's',
        aggregation: { kind: 'rate', groupBy: [] },
      },
      {
        id: 'startup',
        title: 'Startup latency',
        metricType: 'run.googleapis.com/container/startup_latencies',
        unit: 'ms',
        aggregation: p([50, 99]),
      },
    ],
  },
  'run-job': {
    resourceType: 'cloud_run_job',
    labels: ['job_name', 'location'],
    charts: [
      {
        id: 'executions',
        title: 'Completed executions',
        metricType: 'run.googleapis.com/job/completed_execution_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.result'] },
      },
      {
        id: 'attempts',
        title: 'Completed task attempts',
        metricType: 'run.googleapis.com/job/completed_task_attempt_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.result'] },
      },
      {
        id: 'cpu',
        title: 'CPU utilization',
        metricType: 'run.googleapis.com/container/cpu/utilizations',
        unit: 'ratio',
        aggregation: p([50, 99]),
      },
      {
        id: 'memory',
        title: 'Memory utilization',
        metricType: 'run.googleapis.com/container/memory/utilizations',
        unit: 'ratio',
        aggregation: p([50, 99]),
      },
    ],
  },
  'function-gen1': {
    resourceType: 'cloud_function',
    labels: ['function_name', 'region'],
    charts: [
      {
        id: 'executions',
        title: 'Executions per second',
        metricType: 'cloudfunctions.googleapis.com/function/execution_count',
        unit: '1/s',
        aggregation: { kind: 'rate', groupBy: ['metric.label.status'] },
      },
      {
        id: 'times',
        title: 'Execution time',
        metricType: 'cloudfunctions.googleapis.com/function/execution_times',
        unit: 'ms',
        aggregation: p([50, 95, 99]),
      },
      {
        id: 'memory',
        title: 'Memory',
        metricType: 'cloudfunctions.googleapis.com/function/user_memory_bytes',
        unit: 'bytes',
        aggregation: p([50, 99]),
      },
      {
        id: 'instances',
        title: 'Active instances',
        metricType: 'cloudfunctions.googleapis.com/function/active_instances',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
    ],
  },
  workflow: {
    resourceType: 'workflows.googleapis.com/Workflow',
    labels: ['workflow_id', 'location'],
    charts: [
      {
        id: 'executions',
        title: 'Finished executions',
        metricType: 'workflows.googleapis.com/finished_execution_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.status'] },
      },
      {
        id: 'times',
        title: 'Execution time',
        metricType: 'workflows.googleapis.com/execution_times',
        unit: 'ms',
        aggregation: p([50, 95, 99]),
      },
      {
        id: 'steps',
        title: 'Completed steps',
        metricType: 'workflows.googleapis.com/completed_steps_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: [] },
      },
    ],
  },
  'tasks-queue': {
    resourceType: 'cloud_tasks_queue',
    labels: ['queue_id'],
    charts: [
      {
        id: 'depth',
        title: 'Queue depth',
        metricType: 'cloudtasks.googleapis.com/queue/depth',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
      {
        id: 'attempts',
        title: 'Attempts by response code',
        metricType: 'cloudtasks.googleapis.com/queue/task_attempt_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.response_code'] },
      },
    ],
  },
  // SPEC-0005 CA-10 (the Pub/Sub rows).
  'pubsub-topic': {
    resourceType: 'pubsub_topic',
    labels: ['topic_id'],
    charts: [
      {
        id: 'publish',
        title: 'Publish requests',
        metricType: 'pubsub.googleapis.com/topic/send_message_operation_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: [] },
      },
      {
        id: 'bytes',
        title: 'Bytes published',
        metricType: 'pubsub.googleapis.com/topic/byte_cost',
        unit: 'bytes',
        aggregation: { kind: 'sum', groupBy: [] },
      },
    ],
  },
  'pubsub-subscription': {
    resourceType: 'pubsub_subscription',
    labels: ['subscription_id'],
    charts: [
      {
        id: 'backlog',
        title: 'Unacknowledged messages',
        metricType: 'pubsub.googleapis.com/subscription/num_undelivered_messages',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
      {
        id: 'oldest',
        title: 'Oldest unacknowledged message age',
        metricType: 'pubsub.googleapis.com/subscription/oldest_unacked_message_age',
        unit: 's',
        aggregation: { kind: 'max', groupBy: [] },
      },
      {
        id: 'acks',
        title: 'Acknowledged messages',
        metricType: 'pubsub.googleapis.com/subscription/ack_message_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: [] },
      },
      {
        id: 'dead',
        title: 'Sent to dead letter',
        metricType: 'pubsub.googleapis.com/subscription/dead_letter_message_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: [] },
      },
    ],
  },
  // SPEC-0004 D-17, SPEC-0005 CA-10 (the Firestore row).
  'firestore-database': {
    resourceType: 'firestore.googleapis.com/Database',
    labels: ['database_id'],
    charts: [
      {
        id: 'reads',
        title: 'Document reads by type',
        metricType: 'firestore.googleapis.com/document/read_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.type'] },
      },
      {
        id: 'writes',
        title: 'Document writes by operation',
        metricType: 'firestore.googleapis.com/document/write_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.op'] },
      },
      {
        id: 'deletes',
        title: 'Document deletes',
        metricType: 'firestore.googleapis.com/document/delete_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: [] },
      },
      {
        id: 'requests',
        title: 'Requests by method and code',
        metricType: 'firestore.googleapis.com/api/request_count',
        unit: 'count',
        aggregation: { kind: 'sum', groupBy: ['metric.label.api_method', 'metric.label.response_code'] },
      },
      {
        id: 'listeners',
        title: 'Snapshot listeners',
        metricType: 'firestore.googleapis.com/network/snapshot_listeners',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
      {
        id: 'connections',
        title: 'Active connections',
        metricType: 'firestore.googleapis.com/network/active_connections',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
    ],
  },
  // SPEC-0006 D-10: storage metrics are sampled daily for size and count, per minute for traffic.
  'storage-bucket': {
    resourceType: 'gcs_bucket',
    labels: ['bucket_name'],
    charts: [
      {
        id: 'bytes',
        title: 'Stored bytes by class',
        metricType: 'storage.googleapis.com/storage/total_bytes',
        unit: 'bytes',
        aggregation: { kind: 'max', groupBy: ['metric.label.storage_class'] },
      },
      {
        id: 'objects',
        title: 'Objects',
        metricType: 'storage.googleapis.com/storage/object_count',
        unit: 'count',
        aggregation: { kind: 'max', groupBy: [] },
      },
      {
        id: 'requests',
        title: 'Requests by method',
        metricType: 'storage.googleapis.com/api/request_count',
        unit: '1/s',
        aggregation: { kind: 'rate', groupBy: ['metric.label.method'] },
      },
      {
        id: 'sent',
        title: 'Bytes sent',
        metricType: 'storage.googleapis.com/network/sent_bytes_count',
        unit: 'bytes',
        aggregation: { kind: 'sum', groupBy: [] },
      },
      {
        id: 'received',
        title: 'Bytes received',
        metricType: 'storage.googleapis.com/network/received_bytes_count',
        unit: 'bytes',
        aggregation: { kind: 'sum', groupBy: [] },
      },
    ],
  },
};

/** Candidate periods (SPEC-0005 D-07): the range over 300 points, rounded up. */
const PERIODS = [60, 300, 600, 3600, 21_600, 86_400];

export function alignmentSeconds(sinceMs: number, untilMs: number): number {
  const ideal = Math.max(1, (untilMs - sinceMs) / 1000 / 300);
  return PERIODS.find((p) => p >= ideal) ?? 86_400;
}

/** Scale factor to the chart unit from the series unit Google reports. */
export function unitScale(seriesUnit: string | null | undefined, chartUnit: MetricUnit): number {
  const u = (seriesUnit ?? '').trim();
  if (chartUnit === 'ms') {
    if (u === 'ns') return 1e-6;
    if (u === 'us') return 1e-3;
    if (u === 's') return 1e3;
    return 1;
  }
  if (chartUnit === 'ratio' && u === '%') return 0.01;
  return 1;
}

/** Escapes a value for a Monitoring filter string. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
