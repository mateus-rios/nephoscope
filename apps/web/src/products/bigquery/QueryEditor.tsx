import {
  BQ_DEFAULT_MAX_BYTES,
  BQ_DOWNLOAD_MAX_ROWS,
  type BqDryRunResult,
  type BqJobRef,
  type BqParam,
  type BqRun,
  type BqStage,
  type BqValue,
  formatBqBytes,
  type OperationAccepted,
} from '@nephoscope/contracts';
import { BookmarkSimpleIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, PlayIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Dialog, Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { ApiError, api, downloadFromApi } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { usePrefs, useUpdatePrefs } from '../../state/queries';
import { useDeleteSaved, useSaved, useSaveItem } from '../logging/api';
import { bqBase, dryRun, runQuery, useJob, usePaged } from './api';
import { ResultsGrid } from './ResultsGrid';

const enc = encodeURIComponent;
const PARAM_TYPES = ['STRING', 'INT64', 'FLOAT64', 'NUMERIC', 'BOOL', 'DATE', 'TIMESTAMP', 'DATETIME'] as const;

interface QueryEditorProps {
  projectId: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  onJob: (ref: BqJobRef) => void;
  height?: number;
  /** Shown above the editor, such as the Log Analytics note. */
  note?: React.ReactNode;
  /** Key of the query history; defaults to the project's BigQuery history. */
  historyKey?: string;
}

/** The default ceiling on bytes billed, kept in Nephoscope's preferences (SPEC-0008 D-02). */
function CeilingSetting({ ceiling }: { ceiling: number }) {
  const update = useUpdatePrefs();
  const [gib, setGib] = useState(() => String(ceiling / 1024 ** 3));
  const value = Number(gib);
  const valid = Number.isFinite(value) && value > 0;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="Default ceiling on bytes billed (GiB)"
        help="Every query runs with this limit; one over it asks before running. Kept in this Nephoscope's preferences."
        className="w-80"
        error={valid ? undefined : 'A number of GiB above zero'}
      >
        <Input value={gib} onChange={(e) => setGib(e.target.value)} inputMode="decimal" />
      </Field>
      <Button
        size="sm"
        disabled={!valid || Math.round(value * 1024 ** 3) === ceiling}
        loading={update.isPending}
        onClick={() =>
          update.mutate(
            { bigqueryMaxBytes: Math.round(value * 1024 ** 3) },
            { onSuccess: () => toast.success(`Ceiling set to ${formatBqBytes(Math.round(value * 1024 ** 3))}`) },
          )
        }
      >
        Save ceiling
      </Button>
    </div>
  );
}

/** The SQL editor (SPEC-0008 D-02): dry run while typing, bytes on Run, a ceiling on every run. */
export function QueryEditor({ projectId, sql, onSqlChange, onJob, height = 260, note, historyKey }: QueryEditorProps) {
  const prefs = usePrefs();
  const ceiling = prefs.data?.bigqueryMaxBytes ?? BQ_DEFAULT_MAX_BYTES;
  const [dry, setDry] = useState<BqDryRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [params, setParams] = useState<BqParam[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [destination, setDestination] = useState<NonNullable<BqRun['destination']>>({
    datasetId: '',
    tableId: '',
    writeDisposition: 'WRITE_EMPTY',
  });
  const [raising, setRaising] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saved = useSaved('bigquery', projectId);
  const save = useSaveItem('bigquery', projectId);
  const removeSaved = useDeleteSaved('bigquery');
  const client = useQueryClient();
  const recentKey = historyKey ?? `bigquery.recent:${projectId}`;
  const recent = useQuery({
    queryKey: ['history', recentKey],
    queryFn: ({ signal }) => api<string[]>(`/api/history/${enc(recentKey)}`, { signal, profileId: null }),
  });
  const validParams = useMemo(() => params.filter((p) => p.name), [params]);

  // Dry run 800 ms after the last edit (D-02, NFR-01).
  useEffect(() => {
    const text = sql.trim();
    if (!text) {
      setDry(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setChecking(true);
      dryRun(projectId, { query: text, params: validParams }, ctl.signal)
        .then((r) => setDry(r))
        .catch((err: unknown) => {
          if (!ctl.signal.aborted)
            setDry({
              ok: false,
              totalBytesProcessed: null,
              statementType: null,
              referencedTables: [],
              error: { message: err instanceof ApiError ? err.problem.detail : String(err), line: null, column: null },
            });
        })
        .finally(() => !ctl.signal.aborted && setChecking(false));
    }, 800);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [sql, projectId, validParams]);

  const markers = useMemo(
    () =>
      dry?.error
        ? [{ line: dry.error.line ?? 1, column: dry.error.column ?? 1, message: dry.error.message, severity: 'error' as const }]
        : [],
    [dry],
  );
  const bytes = dry?.ok ? Number(dry.totalBytesProcessed ?? 0) : null;

  const execute = useCallback(
    async (limit: number) => {
      const text = sql.trim();
      if (!text) return;
      setRunning(true);
      try {
        const r = await runQuery(projectId, {
          query: text,
          params: validParams,
          maximumBytesBilled: String(limit),
          destination: destination.datasetId && destination.tableId ? destination : undefined,
        });
        useOperations.getState().upsert(r.operation);
        onJob(r.job);
        setRaising(null);
        void api(`/api/history/${enc(recentKey)}`, { body: { value: text }, profileId: null }).then(() =>
          client.invalidateQueries({ queryKey: ['history', recentKey] }),
        );
      } catch (err) {
        toast.error('The query could not start', {
          description: err instanceof ApiError ? err.problem.detail : String(err),
          duration: 10_000,
        });
      } finally {
        setRunning(false);
      }
    },
    [sql, projectId, validParams, destination, onJob, recentKey, client],
  );

  const run = useCallback(() => {
    if (bytes !== null && bytes > ceiling) {
      setRaising(String(bytes));
      return;
    }
    void execute(ceiling);
  }, [bytes, ceiling, execute]);

  const runLabel = checking ? 'Run · estimating…' : bytes !== null ? `Run · ${formatBqBytes(bytes)}` : 'Run';
  const blocked = !sql.trim() ? 'Write a query first' : dry && !dry.ok ? 'Fix the error first' : null;
  return (
    <div className="flex flex-col gap-2">
      {note}
      <div className="px-6">
        <CodeEditor
          value={sql}
          onChange={onSqlChange}
          language="googlesql"
          height={height}
          label="SQL"
          markers={markers}
          onRun={run}
          path="query.sql"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6">
        <Button variant="commit" icon={PlayIcon} loading={running} disabled={!!blocked} disabledReason={blocked} onClick={run}>
          {runLabel}
        </Button>
        <span className="text-meta text-ink-2" aria-live="polite">
          {dry?.error
            ? dry.error.message
            : bytes !== null
              ? `This query will process ${formatBqBytes(bytes)} when run. Ceiling: ${formatBqBytes(ceiling)}.`
              : 'Ctrl+Enter runs the query. It is priced before it runs.'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            Query settings
          </Button>
          <Menu trigger={<Button icon={ClockCounterClockwiseIcon}>Recent</Button>} align="end">
            {(recent.data ?? []).length === 0 ? <MenuGroupLabel>No recent queries</MenuGroupLabel> : null}
            {(recent.data ?? []).map((q) => (
              <MenuItem key={q} onClick={() => onSqlChange(q)}>
                <span className="max-w-[28rem] truncate font-mono text-[11px]">{q}</span>
              </MenuItem>
            ))}
          </Menu>
          <Menu trigger={<Button icon={BookmarkSimpleIcon}>Saved</Button>} align="end">
            <MenuItem onClick={() => setSaving(true)} disabled={!sql.trim()}>
              Save this query
            </MenuItem>
            <MenuSeparator />
            {(saved.data ?? []).length === 0 ? <MenuGroupLabel>No saved queries</MenuGroupLabel> : null}
            {(saved.data ?? []).map((s) => (
              <MenuItem key={s.id} onClick={() => onSqlChange(s.value)}>
                <span className="max-w-[28rem] truncate">{s.name}</span>
              </MenuItem>
            ))}
            {(saved.data ?? []).map((s) => (
              <MenuItem key={`rm-${s.id}`} onClick={() => removeSaved.mutate(s.id)}>
                <span className="max-w-[28rem] truncate text-ink-2">Remove {s.name}</span>
              </MenuItem>
            ))}
          </Menu>
        </span>
      </div>
      {showSettings ? (
        <div className="mx-6 flex flex-col gap-3 rounded-control border border-rule p-3">
          <CeilingSetting ceiling={ceiling} />
          <span className="text-dense font-medium text-ink">Named parameters</span>
          {params.map((p, i) => (
            <div key={`param-${i.toString()}`} className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="w-40">
                <Input
                  value={p.name}
                  onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  mono
                />
              </Field>
              <Field label="Type" className="w-36">
                <Select<BqParam['type']>
                  value={p.type}
                  onValueChange={(type) => setParams(params.map((x, j) => (j === i ? { ...x, type } : x)))}
                  options={PARAM_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </Field>
              <Field label="Value" className="min-w-48 flex-1">
                <Input
                  value={p.value}
                  onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  mono
                />
              </Field>
              <IconButton
                icon={TrashIcon}
                label={`Remove parameter ${p.name || i + 1}`}
                onClick={() => setParams(params.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <span>
            <Button size="sm" icon={PlusIcon} onClick={() => setParams([...params, { name: '', type: 'STRING', value: '' }])}>
              Add parameter
            </Button>
          </span>
          <span className="text-dense font-medium text-ink">Destination table (optional)</span>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Dataset" className="w-48">
              <Input value={destination.datasetId} onChange={(e) => setDestination({ ...destination, datasetId: e.target.value })} mono />
            </Field>
            <Field label="Table" className="w-48">
              <Input value={destination.tableId} onChange={(e) => setDestination({ ...destination, tableId: e.target.value })} mono />
            </Field>
            <Field label="If the table exists" className="w-56">
              <Select<NonNullable<BqRun['destination']>['writeDisposition']>
                value={destination.writeDisposition}
                onValueChange={(writeDisposition) => setDestination({ ...destination, writeDisposition })}
                options={[
                  { value: 'WRITE_EMPTY', label: 'Fail' },
                  { value: 'WRITE_TRUNCATE', label: 'Replace its rows' },
                  { value: 'WRITE_APPEND', label: 'Append rows' },
                ]}
              />
            </Field>
          </div>
        </div>
      ) : null}
      <Dialog
        open={raising !== null}
        onOpenChange={(o) => !o && setRaising(null)}
        title="Raise the ceiling for this run?"
        footer={
          <>
            <Button onClick={() => setRaising(null)}>Cancel</Button>
            <Button variant="commit" loading={running} onClick={() => void execute(Number(raising))}>
              Run with a ceiling of {formatBqBytes(raising)}
            </Button>
          </>
        }
      >
        <p className="m-0 text-dense text-ink">
          This query will process {formatBqBytes(raising)}, more than your ceiling of {formatBqBytes(ceiling)}. BigQuery bills by bytes
          processed. Running raises the ceiling for this run only.
        </p>
      </Dialog>
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save query"
        footer={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button
              variant="commit"
              disabled={!saveName.trim()}
              loading={save.isPending}
              onClick={() => save.mutate({ name: saveName.trim(), value: sql.trim() }, { onSuccess: () => setSaving(false) })}
            >
              Save query
            </Button>
          </>
        }
      >
        <Field label="Name" help="Saved queries stay in this Nephoscope, per project.">
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}

const stageColumns: ResourceColumn<BqStage>[] = [
  { id: 'name', header: 'Stage', hideable: false, cell: (s) => <span className="font-mono text-[12px]">{s.name}</span> },
  { id: 'status', header: 'Status', width: '8rem', cell: (s) => s.status ?? '' },
  {
    id: 'read',
    header: 'Records read',
    width: '9rem',
    align: 'right',
    cell: (s) => (s.recordsRead ? Number(s.recordsRead).toLocaleString() : ''),
  },
  {
    id: 'written',
    header: 'Records written',
    width: '9rem',
    align: 'right',
    cell: (s) => (s.recordsWritten ? Number(s.recordsWritten).toLocaleString() : ''),
  },
  { id: 'slot', header: 'Slot ms', width: '8rem', align: 'right', cell: (s) => (s.slotMs ? Number(s.slotMs).toLocaleString() : '') },
];

/** A job's state, results and execution details (SPEC-0008 D-03, D-04). */
export function JobResults({ projectId, job: ref }: { projectId: string; job: BqJobRef }) {
  const job = useJob(projectId, ref, true);
  const done = job.data?.state === 'DONE';
  const failed = done && !!job.data?.error;
  const path = `${bqBase(projectId)}/jobs/${enc(ref.location)}/${enc(ref.jobId)}`;
  const results = usePaged(
    projectId,
    ['results', ref.location, ref.jobId],
    `${path}/results`,
    done && !failed && job.data?.type === 'QUERY',
  );
  const rows = useMemo(() => (results.data?.pages ?? []).flatMap((p) => p.rows) as BqValue[][], [results.data]);
  const schema = results.data?.pages[0]?.schema ?? [];
  const total = results.data?.pages[0]?.totalRows ?? null;
  const [exporting, setExporting] = useState(false);
  const [uri, setUri] = useState('');
  const [format, setFormat] = useState('CSV');
  const tooMany = Number(total ?? 0) > BQ_DOWNLOAD_MAX_ROWS;
  if (job.isPending) return <DelayedSkeleton rows={4} className="px-6" />;
  if (job.error instanceof ApiError) return <p className="m-0 px-6 text-dense text-redline-ink">{job.error.problem.detail}</p>;
  const j = job.data;
  if (!j) return null;
  async function download(kind: 'csv' | 'json') {
    try {
      await downloadFromApi(`${path}/download?format=${kind}`, `${ref.jobId}.${kind === 'csv' ? 'csv' : 'jsonl'}`);
    } catch (err) {
      toast.error('Download failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    }
  }
  async function exportResults() {
    try {
      const r = await api<OperationAccepted>(`${path}/export`, { body: { uri, format } });
      useOperations.getState().upsert(r.operation);
      toast('Export started', { description: 'Follow it in the operations tray.' });
      setExporting(false);
    } catch (err) {
      toast.error('Export failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    }
  }
  return (
    <Section
      title="Results"
      actions={
        done && !failed ? (
          <span className="flex gap-2">
            <Menu trigger={<Button icon={DownloadSimpleIcon}>Download</Button>} align="end">
              {tooMany ? <MenuGroupLabel>Over {BQ_DOWNLOAD_MAX_ROWS.toLocaleString()} rows: export instead</MenuGroupLabel> : null}
              <MenuItem disabled={tooMany} onClick={() => void download('csv')}>
                Download as CSV
              </MenuItem>
              <MenuItem disabled={tooMany} onClick={() => void download('json')}>
                Download as JSON lines
              </MenuItem>
            </Menu>
            <Button onClick={() => setExporting(true)}>Export to Cloud Storage</Button>
          </span>
        ) : !done ? (
          <Button onClick={() => void api(`${path}/cancel`, { method: 'POST' }).catch(() => undefined)}>Cancel query</Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4 px-6">
          <StatusGlyph
            kind={!done ? 'running' : failed ? 'error' : 'ok'}
            label={!done ? j.state.toLowerCase() : failed ? 'Failed' : 'Done'}
          />
          <span className="font-mono text-[11px] text-ink-3">{ref.jobId}</span>
        </div>
        {failed ? (
          <p role="alert" className="m-0 px-6 text-dense text-redline-ink">
            {j.error}
          </p>
        ) : null}
        {done && !failed && j.type === 'QUERY' ? (
          results.isPending ? (
            <DelayedSkeleton rows={6} />
          ) : results.error instanceof ApiError ? (
            <p className="m-0 px-6 text-dense text-redline-ink">{results.error.problem.detail}</p>
          ) : schema.length === 0 ? (
            <p className="m-0 px-6 text-dense text-ink-2">The statement returned no rows.</p>
          ) : (
            <ResultsGrid
              schema={schema}
              rows={rows}
              label="Query results"
              total={total ? Number(total) : null}
              hasMore={results.hasNextPage}
              loadingMore={results.isFetchingNextPage}
              onLoadMore={() => void results.fetchNextPage()}
            />
          )
        ) : null}
        {done ? (
          <div className="px-6">
            <FactList
              facts={[
                ['Bytes processed', formatBqBytes(j.totalBytesProcessed)],
                ['Bytes billed', formatBqBytes(j.totalBytesBilled)],
                ['Slot time', j.totalSlotMs ? `${(Number(j.totalSlotMs) / 1000).toFixed(1)} s` : ''],
                ['Cache hit', j.cacheHit === null ? '' : j.cacheHit ? 'Yes' : 'No'],
                ['Statement', j.statementType ?? ''],
                ['Destination', j.destination ? `${j.destination.projectId}.${j.destination.datasetId}.${j.destination.tableId}` : ''],
              ]}
            />
          </div>
        ) : null}
        {done && j.stages.length > 0 ? (
          <ResourceTable
            tableId="bq-stages"
            label="Execution stages"
            rows={j.stages}
            columns={stageColumns}
            getRowId={(s) => s.name}
            emptyTitle="No stages"
          />
        ) : null}
      </div>
      <Dialog
        open={exporting}
        onOpenChange={setExporting}
        title="Export results to Cloud Storage"
        footer={
          <>
            <Button onClick={() => setExporting(false)}>Cancel</Button>
            <Button
              variant="commit"
              disabled={!/^gs:\/\/[a-z0-9._-]+\/.+$/.test(uri)}
              disabledReason="A gs:// path"
              onClick={() => void exportResults()}
            >
              Export
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Destination" help="Use * to split large results into files: gs://bucket/results-*.csv">
            <Input value={uri} onChange={(e) => setUri(e.target.value)} mono />
          </Field>
          <Field label="Format">
            <Select<string>
              value={format}
              onValueChange={setFormat}
              options={[
                { value: 'CSV', label: 'CSV' },
                { value: 'NEWLINE_DELIMITED_JSON', label: 'JSON lines' },
                { value: 'AVRO', label: 'Avro' },
                { value: 'PARQUET', label: 'Parquet' },
              ]}
            />
          </Field>
          <EquivalentCommand
            gcloud={`bq extract --destination_format=${format} ${j.destination ? `${j.destination.projectId}:${j.destination.datasetId}.${j.destination.tableId}` : 'TABLE'} ${uri || 'gs://BUCKET/results-*.csv'}`}
          />
        </div>
      </Dialog>
    </Section>
  );
}
