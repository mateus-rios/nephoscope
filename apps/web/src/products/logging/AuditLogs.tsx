import type { LogEntry, LogPage } from '@nephoscope/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Select } from '../../design/Form';
import { JsonTree } from '../../design/JsonTree';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from '../../kit/timeRange';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

/** Audit log kinds and their log ids (SPEC-0005 D-04). */
export const auditKinds = {
  activity: { label: 'Admin Activity', log: 'cloudaudit.googleapis.com/activity' },
  data_access: { label: 'Data Access', log: 'cloudaudit.googleapis.com/data_access' },
  system_event: { label: 'System Event', log: 'cloudaudit.googleapis.com/system_event' },
  policy: { label: 'Policy Denied', log: 'cloudaudit.googleapis.com/policy' },
} as const;
type AuditKind = keyof typeof auditKinds;
const kinds = Object.keys(auditKinds) as AuditKind[];

export function auditFilter(projectId: string, kind: AuditKind): string {
  return `logName="projects/${projectId}/logs/${encodeURIComponent(auditKinds[kind].log)}"`;
}

type Proto = {
  authenticationInfo?: { principalEmail?: string };
  methodName?: string;
  resourceName?: string;
  serviceName?: string;
  status?: { code?: number; message?: string };
};
const proto = (e: LogEntry): Proto => ((e.raw as { protoPayload?: Proto } | null)?.protoPayload ?? {}) as Proto;

/** Cloud Audit Logs with their principal, method and resource as columns (SPEC-0005 D-04). */
export function AuditLogs({ projectId }: { projectId: string }) {
  const profileId = useSession((s) => s.profileId);
  const [kind, setKind] = useSearchState<AuditKind>('audit', 'activity', kinds);
  const [range, setRange] = useSearchState<TimeRange>('range', '1d', timeRanges);
  const [open, setOpen] = useState<LogEntry | null>(null);
  const [anchor] = useState(() => Date.now());
  const query = useInfiniteQuery({
    queryKey: ['audit-logs', profileId, projectId, kind, range, anchor],
    queryFn: ({ pageParam, signal }) =>
      api<LogPage>(
        `/api/projects/${encodeURIComponent(projectId)}/logs${qs({
          filter: auditFilter(projectId, kind),
          since: rangeStart(range, anchor),
          until: new Date(anchor).toISOString(),
          pageSize: 200,
          pageToken: pageParam,
        })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.entries), [query.data]);
  const columns: ResourceColumn<LogEntry>[] = [
    {
      id: 'time',
      header: 'Time',
      width: '9rem',
      hideable: false,
      sortValue: (e) => e.timestamp ?? '',
      cell: (e) => <Timestamp iso={e.timestamp} />,
    },
    {
      id: 'principal',
      header: 'Principal',
      sortValue: (e) => proto(e).authenticationInfo?.principalEmail ?? '',
      cell: (e) => <Mono value={proto(e).authenticationInfo?.principalEmail ?? ''} />,
    },
    {
      id: 'method',
      header: 'Method',
      sortValue: (e) => proto(e).methodName ?? '',
      cell: (e) => <Mono value={proto(e).methodName ?? ''} />,
    },
    { id: 'resource', header: 'Resource', cell: (e) => <Mono value={proto(e).resourceName ?? ''} /> },
    {
      id: 'status',
      header: 'Result',
      width: '8rem',
      cell: (e) => {
        const code = proto(e).status?.code;
        return code ? <StatusGlyph kind="error" label={`Code ${code}`} /> : <StatusGlyph kind="ok" label="OK" />;
      },
    },
    { id: 'service', header: 'Service', width: '12rem', defaultHidden: true, cell: (e) => <Mono value={proto(e).serviceName ?? ''} /> },
  ];
  const problem = query.error instanceof ApiError ? query.error.problem : null;
  return (
    <div className="pt-3">
      {query.isPending && !problem ? (
        <DelayedSkeleton />
      ) : problem ? (
        <ProblemState problem={problem} onRetry={() => void query.refetch()} />
      ) : (
        <ResourceTable
          tableId="audit-logs"
          label="Audit log entries"
          rows={rows}
          columns={columns}
          getRowId={(e) => e.id}
          onOpen={setOpen}
          emptyTitle={`No ${auditKinds[kind].label} entries`}
          emptyText="Nothing was recorded in this range. Data Access logs are written only for services where they are turned on."
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Audit log" className="w-48">
                <Select<AuditKind>
                  value={kind}
                  onValueChange={setKind}
                  options={kinds.map((k) => ({ value: k, label: auditKinds[k].label }))}
                />
              </Field>
              <Field label="Range" className="w-44">
                <Select<TimeRange>
                  value={range}
                  onValueChange={setRange}
                  options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
                />
              </Field>
            </div>
          }
        />
      )}
      <Sheet
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={proto(open ?? ({ raw: {} } as LogEntry)).methodName ?? 'Audit log entry'}
      >
        {open ? <JsonTree value={open.raw} label="Audit log entry" expandDepth={3} height={640} /> : null}
      </Sheet>
    </div>
  );
}
