import type { AuditEntry } from '@nephoscope/contracts';
import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { TitleBlock } from '../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../design/Feedback';
import { Field, Select } from '../design/Form';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { StatusGlyph } from '../design/Status';
import { Mono, Timestamp } from '../design/Values';
import { ApiError } from '../lib/api';
import { useAudit, useProfiles } from '../state/queries';

type OutcomeFilter = 'all' | 'ok' | 'error' | 'rejected';

/** Everything done through Nephoscope on this machine, newest first (SPEC-0001 CA-52). */
export function ActivityPage() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId;
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const audit = useAudit({ projectId, outcome: outcome === 'all' ? undefined : outcome });
  const profiles = useProfiles();
  const nameOf = useMemo(() => new Map((profiles.data ?? []).map((p) => [p.id, p.name])), [profiles.data]);

  const columns: ResourceColumn<AuditEntry>[] = [
    { id: 'ts', header: 'When', width: '9rem', hideable: false, sortValue: (e) => e.ts, cell: (e) => <Timestamp iso={e.ts} /> },
    {
      id: 'outcome',
      header: 'Outcome',
      width: '8rem',
      sortValue: (e) => e.outcome,
      cell: (e) =>
        e.outcome === 'ok' ? (
          <StatusGlyph kind="ok" label="Done" />
        ) : e.outcome === 'rejected' ? (
          <StatusGlyph kind="warn" label="Refused" />
        ) : (
          <StatusGlyph kind="error" label="Failed" />
        ),
    },
    {
      id: 'verb',
      header: 'Action',
      width: '13rem',
      sortValue: (e) => e.verb,
      cell: (e) => <span className="font-mono text-[12px] text-ink">{e.verb}</span>,
    },
    {
      id: 'resource',
      header: 'Resource',
      sortValue: (e) => e.resource ?? '',
      cell: (e) => (e.resource ? <Mono value={e.resource} /> : <span className="text-ink-3">None</span>),
    },
    {
      id: 'profile',
      header: 'Profile',
      width: '11rem',
      sortValue: (e) => (e.profileId ? (nameOf.get(e.profileId) ?? e.profileId) : ''),
      cell: (e) => <span className="text-ink-2">{e.profileId ? (nameOf.get(e.profileId) ?? 'Removed profile') : 'None'}</span>,
    },
    {
      id: 'principal',
      header: 'Principal',
      defaultHidden: true,
      sortValue: (e) => e.principal ?? '',
      cell: (e) => (e.principal ? <Mono value={e.principal} /> : null),
    },
    {
      id: 'project',
      header: 'Project',
      width: '11rem',
      defaultHidden: !!projectId,
      sortValue: (e) => e.projectId ?? '',
      cell: (e) => (e.projectId ? <Mono value={e.projectId} /> : <span className="text-ink-3">None</span>),
    },
    {
      id: 'code',
      header: 'Reason',
      width: '12rem',
      sortValue: (e) => e.problemCode ?? '',
      cell: (e) => (e.problemCode ? <span className="font-mono text-[11px] text-ink-2">{e.problemCode}</span> : null),
    },
  ];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Activity"
        subtitle={
          projectId
            ? `Every change attempted through Nephoscope in ${projectId}, newest first. Kept on this machine only.`
            : 'Every change attempted through Nephoscope, newest first. Kept on this machine only.'
        }
      />
      <div className="pt-3">
        {audit.isPending ? (
          <DelayedSkeleton />
        ) : audit.error instanceof ApiError ? (
          <ProblemState problem={audit.error.problem} onRetry={() => void audit.refetch()} />
        ) : (
          <ResourceTable
            tableId={projectId ? 'activity-project' : 'activity'}
            label="Activity"
            rows={audit.data ?? []}
            columns={columns}
            getRowId={(e) => `${e.ts}-${e.verb}-${e.resource ?? ''}`}
            filtered={outcome !== 'all'}
            emptyTitle="Nothing done yet"
            emptyText="Changes made through Nephoscope, and the ones it refused, appear here."
            toolbar={
              <Field label="Outcome" className="w-44">
                <Select<OutcomeFilter>
                  value={outcome}
                  onValueChange={setOutcome}
                  options={[
                    { value: 'all', label: 'All outcomes' },
                    { value: 'ok', label: 'Done' },
                    { value: 'error', label: 'Failed' },
                    { value: 'rejected', label: 'Refused' },
                  ]}
                />
              </Field>
            }
          />
        )}
      </div>
    </div>
  );
}
