import type { FunctionGeneration, FunctionState, FunctionSummary } from '@nephoscope/contracts';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Input } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Tooltip } from '../../design/Tooltip';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { useFunctions } from './api';

export const generationLabel: Record<FunctionGeneration, string> = { gen1: '1st gen', gen2: '2nd gen', run: 'Cloud Run' };

export function FunctionStateGlyph({ state }: { state: FunctionState }) {
  switch (state) {
    case 'active':
      return <StatusGlyph kind="ok" label="Active" />;
    case 'deploying':
      return <StatusGlyph kind="running" label="Deploying" />;
    case 'failed':
      return <StatusGlyph kind="error" label="Failed" />;
    case 'deleting':
      return <StatusGlyph kind="running" label="Deleting" />;
    default:
      return <StatusGlyph kind="unknown" label="Unknown" />;
  }
}

/** Where a function opens: its own page, or the Cloud Run service for Cloud Run functions. */
export function functionHref(projectId: string, f: FunctionSummary): string {
  return f.generation === 'run' ? `/p/${projectId}/run/services/${f.location}/${f.id}` : `/p/${projectId}/functions/${f.location}/${f.id}`;
}

function triggerText(f: FunctionSummary): string {
  if (f.trigger.kind === 'http') return 'HTTP';
  const type = f.trigger.eventType ?? 'Event';
  const short = type
    .replace(/^google\.cloud\./, '')
    .replace(/^providers\/cloud\./, '')
    .replace(/\.v1\./, '.');
  return f.trigger.resource ? `${short} (${f.trigger.resource})` : short;
}

/** One list of every function, whatever created it (SPEC-0003 D-07, CA-14). */
export function FunctionsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useFunctions(projectId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const location = useFacet('location');
  const generation = useFacet('generation');
  const trigger = useFacet('trigger');
  useEffect(() => {
    document.title = 'Functions · Nephoscope';
  }, []);
  const all = query.data?.items ?? [];
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (f) =>
          (location === 'all' || f.location === location) &&
          (generation === 'all' || f.generation === generation) &&
          (trigger === 'all' || f.trigger.kind === trigger) &&
          (!q || f.id.toLowerCase().includes(q) || (f.runtime ?? '').includes(q)),
      ),
    [all, location, generation, trigger, q],
  );

  const columns: ResourceColumn<FunctionSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (f) => f.id,
      cell: (f) => (
        <Link to={functionHref(projectId, f)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {f.id}
        </Link>
      ),
    },
    { id: 'state', header: 'Status', width: '8rem', sortValue: (f) => f.state, cell: (f) => <FunctionStateGlyph state={f.state} /> },
    {
      id: 'generation',
      header: 'Generation',
      width: '8rem',
      sortValue: (f) => f.generation,
      cell: (f) =>
        f.generation === 'run' ? (
          <Tooltip content="Deployed as a Cloud Run service from function source; managed in Cloud Run">
            <span>
              <Chip>{generationLabel[f.generation]}</Chip>
            </span>
          </Tooltip>
        ) : (
          <span className="text-ink-2">{generationLabel[f.generation]}</span>
        ),
    },
    {
      id: 'runtime',
      header: 'Runtime',
      width: '8rem',
      sortValue: (f) => f.runtime ?? '',
      cell: (f) => <span className="font-mono text-[12px] text-ink-2">{f.runtime}</span>,
    },
    {
      id: 'trigger',
      header: 'Trigger',
      sortValue: (f) => triggerText(f),
      cell: (f) => <span className="truncate text-ink-2">{triggerText(f)}</span>,
    },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (f) => f.location, cell: (f) => <Mono value={f.location} /> },
    {
      id: 'updated',
      header: 'Last deployed',
      width: '8.5rem',
      sortValue: (f) => f.updateTime ?? '',
      cell: (f) => <Timestamp iso={f.updateTime} />,
    },
    { id: 'url', header: 'URL', defaultHidden: true, cell: (f) => (f.url ? <Mono value={f.url} copy /> : null) },
  ];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Run functions"
        subtitle="Functions of every generation and region, including the ones deployed through Cloud Run."
      />
      <Notes notes={partialNote(query.data?.unreachable)} />
      <div className="pt-3">
        {query.isPending ? (
          <DelayedSkeleton />
        ) : query.error instanceof ApiError ? (
          <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
        ) : (
          <ResourceTable
            tableId="functions"
            label="Functions"
            rows={rows}
            columns={columns}
            getRowId={(f) => f.name}
            onOpen={(f) => void navigate({ to: functionHref(projectId, f) })}
            filtered={rows.length !== all.length}
            emptyTitle="No functions yet"
            emptyText="Deploy one with gcloud functions deploy, or gcloud run deploy --function from a source folder."
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name or runtime"
                  aria-label="Filter functions"
                  className="w-64"
                />
                <Facet label="Location" param="location" rows={all} valueFor={(f) => f.location} />
                <Facet
                  label="Generation"
                  param="generation"
                  rows={all}
                  valueFor={(f) => f.generation}
                  labelOf={(v) => generationLabel[v as FunctionGeneration] ?? v}
                  className="w-40"
                />
                <Facet
                  label="Trigger"
                  param="trigger"
                  rows={all}
                  valueFor={(f) => f.trigger.kind}
                  labelOf={(v) => (v === 'http' ? 'HTTP' : 'Event')}
                  className="w-32"
                />
                <span className="ml-auto">
                  <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
                </span>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
