import type { ColabExecutionOutput } from '@nephoscope/contracts';
import { PlayIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { bytes } from '../../lib/format';
import {
  colabHref,
  deleteExecution,
  shortName,
  useExecution,
  useExecutionNotebook,
  useExecutionOutput,
  useNotebooks,
  useRaw,
  useSchedules,
  useTemplates,
} from './api';
import { FactList, isJobDone, JobStateGlyph, jobFacts, namesOf, runDuration, StorageLink, useColabReadOnly } from './common';
import { NotebookView } from './NotebookView';
import { RunSheet } from './RunSheet';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'output', label: 'Output' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function OutputTab({
  projectId,
  location,
  id,
  output,
  done,
}: {
  projectId: string;
  location: string;
  id: string;
  output: ColabExecutionOutput;
  done: boolean;
}) {
  const notebook = useExecutionNotebook(projectId, location, id, output.notebook);
  if (!output.uri) return <p className="m-0 px-6 py-6 text-dense text-ink-2">This run has no Cloud Storage output location.</p>;
  if (output.objects.length === 0) {
    return (
      <p className="m-0 px-6 py-6 text-dense text-ink-2">
        {done ? 'Nothing was found under ' : 'The run writes its results under '}
        <StorageLink projectId={projectId} uri={output.uri} />
        {done ? '. Open the output location to look around it.' : ' when it finishes.'}
      </p>
    );
  }
  return (
    <>
      <Section title="Files" description={output.uri}>
        <ul className="m-0 flex list-none flex-col gap-1 px-6">
          {output.objects.map((o) => (
            <li key={o.name} className="grid grid-cols-[minmax(0,1fr)_6rem_8rem] items-baseline gap-4 text-dense">
              <StorageLink projectId={projectId} uri={`gs://${output.bucket}/${o.name}`} />
              <span className="tnum text-right text-ink-2">{bytes(o.size)}</span>
              <Timestamp iso={o.updated} />
            </li>
          ))}
        </ul>
      </Section>
      {output.notebook ? (
        <Section title="Executed notebook" description={shortName(output.notebook)}>
          {notebook.isPending ? (
            <DelayedSkeleton rows={8} />
          ) : notebook.error instanceof ApiError ? (
            <ProblemState problem={notebook.error.problem} onRetry={() => void notebook.refetch()} />
          ) : notebook.data ? (
            <NotebookView doc={notebook.data} caption={shortName(output.notebook)} />
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

/** One notebook execution (SPEC-0010 D-08, D-10, CA-05). */
export function ExecutionPage() {
  const { projectId, location, execution: id } = useParams({ strict: false }) as { projectId: string; location: string; execution: string };
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const query = useExecution(projectId, location, id);
  const output = useExecutionOutput(projectId, location, id, tab === 'output');
  const raw = useRaw(projectId, 'executions', location, id, tab === 'yaml');
  const readOnly = useColabReadOnly();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'run' | 'delete' | null>(null);
  const notebooks = useNotebooks(projectId, location);
  const templates = useTemplates(projectId, location);
  const schedules = useSchedules(projectId, location, !!query.data?.schedule);
  const names = useMemo(
    () => ({
      notebooks: namesOf(notebooks.data?.items),
      templates: namesOf(templates.data?.items),
      schedules: namesOf(schedules.data?.items),
    }),
    [notebooks.data, templates.data, schedules.data],
  );

  const e = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !e)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const done = isJobDone(e.state);
  const notes: Note[] = [];
  if (e.status?.message && e.state !== 'succeeded') notes.push({ id: 'status', tone: 'error', text: e.status.message });
  if (!done)
    notes.push({
      id: 'live',
      tone: 'info',
      text: 'The run is still going. Refresh to see its state; the executed notebook appears when it finishes.',
    });

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Colab Enterprise', to: colabHref.list(projectId, 'executions') }, { label: e.displayName || e.id }]}
        title={e.displayName || e.id}
        status={<JobStateGlyph state={e.state} />}
        actions={
          <>
            <Button onClick={() => void query.refetch()} loading={query.isRefetching}>
              Refresh
            </Button>
            {e.source.kind === 'notebook' ? (
              <Button variant="commit" icon={PlayIcon} onClick={() => setDialog('run')} disabled={!!readOnly} disabledReason={readOnly}>
                Run again
              </Button>
            ) : null}
          </>
        }
        menu={
          <MenuItem onClick={() => setDialog('delete')} className="text-redline-ink" disabled={!!readOnly}>
            Delete execution
          </MenuItem>
        }
        cells={[
          { label: 'Started', value: <Timestamp iso={e.createTime} /> },
          { label: done ? 'Duration' : 'Running for', value: runDuration(e) || 'Unknown' },
          {
            label: 'Schedule',
            value: e.schedule ? (
              <Link to={colabHref.schedule(projectId, e.location, shortName(e.schedule)) as string}>
                {names.schedules.get(shortName(e.schedule)) ?? shortName(e.schedule)}
              </Link>
            ) : (
              'Manual'
            ),
          },
          { label: 'Region', value: <Mono value={e.location} />, mono: true },
          { label: 'ID', value: <Mono value={e.id} copy />, mono: true },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return (
                <>
                  <Notes notes={notes} title="Status" />
                  <Section title="Run">
                    <FactList facts={jobFacts(projectId, e, names)} />
                  </Section>
                  {Object.keys(e.labels).length > 0 ? (
                    <Section title="Labels">
                      <FactList facts={Object.entries(e.labels).map(([k, v]) => [k, <Mono key={k} value={v} />])} />
                    </Section>
                  ) : null}
                </>
              );
            case 'output':
              return output.isPending ? (
                <DelayedSkeleton rows={6} />
              ) : output.error instanceof ApiError ? (
                <ProblemState problem={output.error.problem} onRetry={() => void output.refetch()} />
              ) : output.data ? (
                <OutputTab projectId={projectId} location={location} id={id} output={output.data} done={done} />
              ) : null;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={e.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      {e.source.kind === 'notebook' ? (
        <RunSheet
          projectId={projectId}
          mode="run"
          open={dialog === 'run'}
          onOpenChange={(o) => !o && setDialog(null)}
          notebook={{ name: e.source.repository, displayName: e.displayName, location: e.location, headSha: null }}
          readOnlyReason={readOnly}
        />
      ) : null}
      <ConfirmDestructive
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete execution"
        consequence="The execution leaves the history. Its results in Cloud Storage stay."
        expected={e.id}
        confirmLabel="Delete execution"
        onConfirm={async (confirm) => {
          await deleteExecution(projectId, location, id, confirm);
          toast('Deleting the execution', { description: 'Follow it in the operations tray.' });
          void navigate({ to: `/p/${projectId}/colab` as string, search: { tab: 'executions' } });
        }}
      />
    </>
  );
}
