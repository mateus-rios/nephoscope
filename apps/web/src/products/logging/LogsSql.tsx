import type { BqJobRef, LogBucket, LogBucketLink } from '@nephoscope/contracts';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Select } from '../../design/Form';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';
import { JobResults, QueryEditor } from '../bigquery/QueryEditor';
import { useLogBuckets } from './api';

const enc = encodeURIComponent;

/** A linked dataset as the Logging API names it: `bigquery.googleapis.com/projects/{p}/datasets/{d}`. */
export function linkedDataset(datasetId: string | null): { project: string; dataset: string } | null {
  const m = /projects\/([^/]+)\/datasets\/([^/]+)$/.exec(datasetId ?? '');
  return m ? { project: m[1] as string, dataset: m[2] as string } : null;
}

export function starterSql(project: string, dataset: string): string {
  return `SELECT timestamp, severity, log_name, resource.type AS resource_type, json_payload, text_payload
FROM \`${project}.${dataset}._AllLogs\`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY timestamp DESC
LIMIT 100`;
}

/** SQL over logs through BigQuery, for buckets with a linked dataset (SPEC-0005 D-06). */
export function LogsSql({ projectId }: { projectId: string }) {
  const profileId = useSession((s) => s.profileId);
  const buckets = useLogBuckets(projectId);
  const analytics = (buckets.data ?? []).filter((b) => b.analyticsEnabled);
  const links = useQueries({
    queries: analytics.map((b: LogBucket) => ({
      queryKey: ['logging', profileId, projectId, 'links', b.name],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<LogBucketLink[]>(`/api/projects/${enc(projectId)}/logging/buckets/${enc(b.location)}/${enc(b.id)}/links`, { signal }),
      enabled: !!profileId,
    })),
  });
  const datasets = useMemo(
    () =>
      links.flatMap((q, i) =>
        (q.data ?? []).flatMap((l) => {
          const d = linkedDataset(l.datasetId);
          return d && l.lifecycleState === 'ACTIVE' ? [{ ...d, bucket: analytics[i]?.id ?? '' }] : [];
        }),
      ),
    [links, analytics],
  );
  const [chosen, setChosen] = useState('');
  const current = datasets.find((d) => `${d.project}.${d.dataset}` === chosen) ?? datasets[0] ?? null;
  const [sql, setSql] = useState('');
  const [job, setJob] = useState<BqJobRef | null>(null);
  useEffect(() => {
    if (current && !sql) setSql(starterSql(current.project, current.dataset));
  }, [current, sql]);

  if (buckets.isPending || links.some((l) => l.isPending)) return <DelayedSkeleton rows={4} className="p-6" />;
  if (buckets.error instanceof ApiError) return <ProblemState problem={buckets.error.problem} onRetry={() => void buckets.refetch()} />;
  if (!current) {
    return (
      <div className="flex flex-col gap-3 pb-6">
        <EmptyState title="No linked dataset">
          SQL over logs runs in BigQuery, on a log bucket upgraded to Log Analytics with a linked dataset. Upgrade a bucket and create the
          link in{' '}
          <Link to={`/p/${projectId}/logging` as string} search={{ tab: 'storage' }} className="underline">
            Log storage
          </Link>
          , or with the commands below.
        </EmptyState>
        <div className="px-6">
          <EquivalentCommand
            gcloud={`gcloud logging buckets update _Default --location=global --enable-analytics --project=${projectId}\ngcloud logging links create logs_sql --bucket=_Default --location=global --project=${projectId}`}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 pt-3">
      <QueryEditor
        projectId={projectId}
        sql={sql}
        onSqlChange={setSql}
        onJob={setJob}
        historyKey={`logs.sql:${projectId}`}
        note={
          <div className="flex flex-wrap items-end gap-3 px-6">
            <p className="m-0 max-w-3xl flex-1 text-dense text-ink">
              These queries run as BigQuery jobs, and BigQuery bills the bytes they process. The estimate on Run is shown before anything
              runs.
            </p>
            {datasets.length > 1 ? (
              <Field label="Linked dataset" className="w-72">
                <Select<string>
                  value={`${current.project}.${current.dataset}`}
                  onValueChange={(v) => {
                    setChosen(v);
                    const d = datasets.find((x) => `${x.project}.${x.dataset}` === v);
                    if (d) setSql(starterSql(d.project, d.dataset));
                  }}
                  options={datasets.map((d) => ({ value: `${d.project}.${d.dataset}`, label: `${d.dataset} (bucket ${d.bucket})` }))}
                />
              </Field>
            ) : null}
          </div>
        }
      />
      {job ? <JobResults key={job.jobId} projectId={projectId} job={job} /> : null}
    </div>
  );
}
