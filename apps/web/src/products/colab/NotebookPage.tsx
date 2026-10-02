import type { ColabCommit, ColabSchedule } from '@nephoscope/contracts';
import { CalendarPlusIcon, DownloadSimpleIcon, FileArrowUpIcon, PlayIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import {
  colabHref,
  deleteNotebook,
  downloadNotebook,
  failed,
  useNotebook,
  useNotebookContent,
  useNotebookHistory,
  useNotebookRuns,
  useNotebookSchedules,
  useRaw,
} from './api';
import { ScheduleStateGlyph, useColabReadOnly } from './common';
import { RenameNotebookDialog, UploadVersionDialog } from './NotebookSheets';
import { NotebookView } from './NotebookView';
import { RunSheet, splitCron } from './RunSheet';
import { RunsTable } from './RunsTable';

const TABS = [
  { key: 'notebook', label: 'Notebook' },
  { key: 'history', label: 'History' },
  { key: 'runs', label: 'Runs' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** One notebook: its cells, versions, runs and schedules (SPEC-0010 D-04 to D-06, CA-02). */
export function NotebookPage() {
  const { projectId, location, notebook: id } = useParams({ strict: false }) as { projectId: string; location: string; notebook: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'notebook',
    TABS.map((t) => t.key),
  );
  const [commit, setCommit] = useSearchState<string>('commit', '');
  const query = useNotebook(projectId, location, id);
  const content = useNotebookContent(projectId, location, id, commit || null, tab === 'notebook' && !!query.data?.path);
  const history = useNotebookHistory(projectId, location, id, tab === 'history');
  const runs = useNotebookRuns(projectId, location, id, tab === 'runs');
  const schedules = useNotebookSchedules(projectId, location, id, tab === 'schedules');
  const raw = useRaw(projectId, 'notebooks', location, id, tab === 'yaml');
  const readOnly = useColabReadOnly();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'run' | 'schedule' | 'upload' | 'rename' | 'delete' | null>(null);

  const n = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !n)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;

  const fileName = n.displayName.endsWith('.ipynb') ? n.displayName : `${n.displayName}.ipynb`;
  const download = (sha?: string | null) =>
    downloadNotebook(projectId, location, id, sha ? fileName.replace(/\.ipynb$/, `.${sha.slice(0, 7)}.ipynb`) : fileName, sha).catch(
      failed('The download'),
    );
  const viewing = commit && commit !== n.head?.sha ? commit : null;
  const notes: Note[] = [];
  if (!n.path) notes.push({ id: 'empty', tone: 'warn', text: 'This notebook has no .ipynb file yet. Upload one to give it content.' });
  if (viewing) {
    notes.push({
      id: 'version',
      tone: 'info',
      text: `Showing version ${viewing.slice(0, 7)}, not the latest.`,
      action: (
        <Button size="sm" variant="ghost" onClick={() => setCommit('')}>
          Show the latest
        </Button>
      ),
    });
  }

  const historyColumns: ResourceColumn<ColabCommit>[] = [
    {
      id: 'sha',
      header: 'Version',
      width: '7rem',
      hideable: false,
      sortValue: (c) => c.time ?? '',
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-[12px] text-ink">{c.sha.slice(0, 7)}</span>
          {c.sha === n.head?.sha ? <span className="text-meta text-ink-3">latest</span> : null}
        </span>
      ),
    },
    {
      id: 'message',
      header: 'Description',
      sortValue: (c) => c.message ?? '',
      cell: (c) => <span className="truncate text-ink">{c.message ?? ''}</span>,
    },
    {
      id: 'author',
      header: 'Author',
      width: '16rem',
      sortValue: (c) => c.authorEmail ?? '',
      cell: (c) => <Mono value={c.authorEmail ?? c.authorName ?? ''} />,
    },
    { id: 'time', header: 'Saved', width: '9rem', sortValue: (c) => c.time ?? '', cell: (c) => <Timestamp iso={c.time} /> },
    {
      id: 'actions',
      header: '',
      width: '11rem',
      hideable: false,
      cell: (c) => (
        <span className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setCommit(c.sha === n.head?.sha ? '' : c.sha);
              setTab('notebook');
            }}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={DownloadSimpleIcon}
            onClick={(e) => {
              e.stopPropagation();
              void download(c.sha);
            }}
          >
            Download
          </Button>
        </span>
      ),
    },
  ];

  const scheduleColumns: ResourceColumn<ColabSchedule>[] = [
    {
      id: 'name',
      header: 'Schedule',
      hideable: false,
      sortValue: (s) => s.displayName,
      cell: (s) => (
        <Link
          to={colabHref.schedule(projectId, s.location, s.id) as string}
          className="truncate font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {s.displayName}
        </Link>
      ),
    },
    { id: 'state', header: 'State', width: '8rem', sortValue: (s) => s.state, cell: (s) => <ScheduleStateGlyph state={s.state} /> },
    { id: 'cron', header: 'Cron', width: '14rem', sortValue: (s) => s.cron, cell: (s) => <Mono value={splitCron(s.cron).expression} /> },
    {
      id: 'next',
      header: 'Next run',
      width: '9rem',
      sortValue: (s) => s.nextRunTime ?? '',
      cell: (s) => <Timestamp iso={s.state === 'active' ? s.nextRunTime : null} />,
    },
  ];

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Colab Enterprise', to: colabHref.list(projectId, 'notebooks') }, { label: n.displayName }]}
        title={n.displayName}
        actions={
          <>
            <Button icon={FileArrowUpIcon} onClick={() => setDialog('upload')} disabled={!!readOnly} disabledReason={readOnly}>
              Upload version
            </Button>
            <Button icon={DownloadSimpleIcon} onClick={() => void download(viewing)} disabled={!n.path}>
              Download
            </Button>
            <Button
              icon={CalendarPlusIcon}
              onClick={() => setDialog('schedule')}
              disabled={!!readOnly || !n.path}
              disabledReason={readOnly}
            >
              Schedule
            </Button>
            <Button
              variant="commit"
              icon={PlayIcon}
              onClick={() => setDialog('run')}
              disabled={!!readOnly || !n.path}
              disabledReason={readOnly}
            >
              Run
            </Button>
          </>
        }
        menu={
          <>
            <MenuItem onClick={() => setDialog('rename')} disabled={!!readOnly}>
              Rename notebook
            </MenuItem>
            <MenuItem onClick={() => setDialog('delete')} className="text-redline-ink" disabled={!!readOnly}>
              Delete notebook
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Region', value: <Mono value={n.location} />, mono: true },
          { label: 'Last saved', value: <Timestamp iso={n.head?.time} /> },
          { label: 'Saved by', value: n.head?.authorEmail ?? 'Unknown', wide: true },
          { label: 'Version', value: n.head ? n.head.sha.slice(0, 7) : 'None', mono: true },
          { label: 'Created', value: <Timestamp iso={n.createTime} /> },
        ]}
        tabs={TABS}
        defaultTab="notebook"
      >
        {(current) => {
          switch (current) {
            case 'notebook':
              return (
                <>
                  <Notes notes={notes} />
                  {!n.path ? null : content.isPending ? (
                    <DelayedSkeleton rows={10} className="p-6" />
                  ) : content.error instanceof ApiError ? (
                    <ProblemState problem={content.error.problem} onRetry={() => void content.refetch()} />
                  ) : content.data ? (
                    <NotebookView doc={content.data} />
                  ) : null}
                </>
              );
            case 'history':
              return history.isPending ? (
                <DelayedSkeleton />
              ) : history.error instanceof ApiError ? (
                <ProblemState problem={history.error.problem} onRetry={() => void history.refetch()} />
              ) : (
                <div className="pt-3">
                  <ResourceTable
                    tableId="colab-history"
                    label="Versions"
                    rows={history.data?.items ?? []}
                    columns={historyColumns}
                    getRowId={(c) => c.sha}
                    emptyTitle="No versions"
                    emptyText="Every save from Colab Enterprise or Nephoscope adds a version."
                  />
                </div>
              );
            case 'runs':
              return (
                <RunsTable
                  projectId={projectId}
                  query={runs}
                  location={location}
                  empty="Runs of this notebook, by hand or from a schedule, appear here."
                />
              );
            case 'schedules':
              return schedules.isPending ? (
                <DelayedSkeleton />
              ) : schedules.error instanceof ApiError ? (
                <ProblemState problem={schedules.error.problem} onRetry={() => void schedules.refetch()} />
              ) : (
                <div className="pt-3">
                  <ResourceTable
                    tableId="colab-notebook-schedules"
                    label="Schedules"
                    rows={schedules.data?.items ?? []}
                    columns={scheduleColumns}
                    getRowId={(s) => s.name}
                    onOpen={(s) => void navigate({ to: colabHref.schedule(projectId, s.location, s.id) as string })}
                    emptyTitle="Not scheduled"
                    emptyText="A schedule runs this notebook on a cron expression."
                    emptyAction={
                      <Button icon={CalendarPlusIcon} onClick={() => setDialog('schedule')} disabled={!!readOnly || !n.path}>
                        Schedule
                      </Button>
                    }
                  />
                </div>
              );
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={n.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <RunSheet
        projectId={projectId}
        mode="run"
        open={dialog === 'run'}
        onOpenChange={(o) => !o && setDialog(null)}
        notebook={{ name: n.name, displayName: n.displayName, location: n.location, headSha: n.head?.sha ?? null }}
        readOnlyReason={readOnly}
      />
      <RunSheet
        projectId={projectId}
        mode="schedule"
        open={dialog === 'schedule'}
        onOpenChange={(o) => !o && setDialog(null)}
        notebook={{ name: n.name, displayName: n.displayName, location: n.location, headSha: n.head?.sha ?? null }}
        readOnlyReason={readOnly}
      />
      <UploadVersionDialog
        projectId={projectId}
        notebook={n}
        open={dialog === 'upload'}
        onOpenChange={(o) => !o && setDialog(null)}
        readOnlyReason={readOnly}
      />
      <RenameNotebookDialog
        projectId={projectId}
        notebook={n}
        open={dialog === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        readOnlyReason={readOnly}
      />
      <ConfirmDestructive
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete notebook"
        consequence={`The notebook ${n.displayName} and every version of it are deleted. Executions and schedules that use it stay, and their next runs fail.`}
        expected={n.displayName}
        confirmLabel="Delete notebook"
        onConfirm={async (confirm) => {
          await deleteNotebook(projectId, location, id, confirm);
          toast.success(`Deleted ${n.displayName}`);
          void navigate({ to: colabHref.list(projectId, 'notebooks').split('?')[0] as string, search: { tab: 'notebooks' } });
        }}
      />
    </>
  );
}
