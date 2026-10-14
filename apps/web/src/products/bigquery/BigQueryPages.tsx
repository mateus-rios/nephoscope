import {
  type BqField,
  type BqJobRef,
  type BqJobSummary,
  type BqTableSummary,
  type BqValue,
  bqLabelChanges,
  formatBqBytes,
  type OperationAccepted,
} from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { queryHints } from '../../design/code/hints';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance, usePrefs, useUpdatePrefs } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';
import {
  bqBase,
  datasetApi,
  datasetHref,
  quoted,
  tableApi,
  tableHref,
  useDataset,
  useDatasets,
  useJobs,
  useModels,
  usePaged,
  useRoutines,
  useTable,
  useTables,
} from './api';
import { PropertiesDialog } from './PropertiesDialog';
import { JobResults, QueryEditor } from './QueryEditor';
import { ResultsGrid } from './ResultsGrid';
import { SchemaEditor } from './SchemaEditor';

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

const TYPE_LABEL: Record<string, string> = {
  TABLE: 'Table',
  VIEW: 'View',
  MATERIALIZED_VIEW: 'Materialized view',
  EXTERNAL: 'External table',
  SNAPSHOT: 'Snapshot',
  CLONE: 'Clone',
};

// ---- Explorer --------------------------------------------------------------------------------

function DatasetNode({
  projectId,
  project,
  datasetId,
  onQuery,
}: {
  projectId: string;
  project: string;
  datasetId: string;
  onQuery: (sql: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tables = useTables(projectId, project, datasetId, open);
  const routines = useRoutines(projectId, project, datasetId, open);
  const models = useModels(projectId, project, datasetId, open);
  useEffect(() => {
    if (!tables.data) return;
    const names = tables.data.map((t) => `${t.projectId}.${t.datasetId}.${t.tableId}`);
    queryHints.sql.tables = [...new Set([...queryHints.sql.tables, ...names])].slice(-5000);
  }, [tables.data]);
  return (
    <li>
      <span className="flex min-h-6 items-center gap-1">
        <IconButton
          icon={open ? CaretDownIcon : CaretRightIcon}
          label={`${open ? 'Collapse' : 'Expand'} ${datasetId}`}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
        <Link to={datasetHref(projectId, project, datasetId) as string} className="truncate font-mono text-[12px] text-ink hover:underline">
          {datasetId}
        </Link>
      </span>
      {open ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 py-0.5 pl-6">
          {tables.isPending ? <li className="text-meta text-ink-3">Loading…</li> : null}
          {tables.error instanceof ApiError ? <li className="text-meta text-redline-ink">{tables.error.problem.detail}</li> : null}
          {(tables.data ?? []).map((t) => (
            <li key={t.tableId} className="flex min-h-6 items-center gap-1">
              <Link
                to={tableHref(projectId, project, datasetId, t.tableId) as string}
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink hover:underline"
                title={TYPE_LABEL[t.type] ?? t.type}
              >
                {t.tableId}
              </Link>
              <span className="shrink-0 text-[10px] text-ink-3">{t.type === 'TABLE' ? '' : (TYPE_LABEL[t.type] ?? t.type)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onQuery(`SELECT *\nFROM ${quoted(project, datasetId, t.tableId)}\nLIMIT 100`)}
              >
                Query
              </Button>
            </li>
          ))}
          {(routines.data ?? []).map((r) => (
            <li key={`r-${r.routineId}`} className="truncate font-mono text-[12px] text-ink-2" title={r.type}>
              {r.routineId} <span className="text-[10px] text-ink-3">routine</span>
            </li>
          ))}
          {(models.data ?? []).map((m) => (
            <li key={`m-${m.modelId}`} className="truncate font-mono text-[12px] text-ink-2">
              {m.modelId} <span className="text-[10px] text-ink-3">model</span>
            </li>
          ))}
          {tables.data && tables.data.length === 0 && (routines.data ?? []).length === 0 ? (
            <li className="text-meta text-ink-3">Empty dataset</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function ProjectNode({
  projectId,
  project,
  pinned,
  onUnpin,
  onQuery,
}: {
  projectId: string;
  project: string;
  pinned: boolean;
  onUnpin: () => void;
  onQuery: (sql: string) => void;
}) {
  const [open, setOpen] = useState(!pinned);
  const datasets = useDatasets(projectId, project, open);
  return (
    <li>
      <span className="flex min-h-6 items-center gap-1">
        <IconButton
          icon={open ? CaretDownIcon : CaretRightIcon}
          label={`${open ? 'Collapse' : 'Expand'} ${project}`}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
        <span className="min-w-0 flex-1 truncate text-dense font-medium text-ink">{project}</span>
        {pinned ? <IconButton icon={XIcon} label={`Remove ${project} from the explorer`} size="sm" onClick={onUnpin} /> : null}
      </span>
      {open ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 pl-4">
          {datasets.isPending ? <li className="text-meta text-ink-3">Loading…</li> : null}
          {datasets.error instanceof ApiError ? <li className="text-meta text-redline-ink">{datasets.error.problem.detail}</li> : null}
          {datasets.data?.length === 0 ? <li className="text-meta text-ink-3">No datasets</li> : null}
          {(datasets.data ?? []).map((d) => (
            <DatasetNode key={d.datasetId} projectId={projectId} project={project} datasetId={d.datasetId} onQuery={onQuery} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Explorer({
  projectId,
  onQuery,
  onCreate,
  readOnly,
}: {
  projectId: string;
  onQuery: (sql: string) => void;
  onCreate: () => void;
  readOnly: string | null;
}) {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const pinned = (prefs.data?.bigqueryProjects ?? []).filter((p) => p !== projectId);
  const [adding, setAdding] = useState('');
  return (
    <aside aria-label="Explorer" className="flex flex-col gap-3 border-b border-rule px-4 py-3 md:border-r md:border-b-0">
      <span className="flex items-center justify-between">
        <span className="text-dense font-semibold text-ink">Explorer</span>
        <Button size="sm" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={onCreate}>
          Dataset
        </Button>
      </span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        <ProjectNode projectId={projectId} project={projectId} pinned={false} onUnpin={() => undefined} onQuery={onQuery} />
        {pinned.map((p) => (
          <ProjectNode
            key={p}
            projectId={projectId}
            project={p}
            pinned
            onQuery={onQuery}
            onUnpin={() => update.mutate({ bigqueryProjects: (prefs.data?.bigqueryProjects ?? []).filter((x) => x !== p) })}
          />
        ))}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const p = adding.trim();
          if (!p) return;
          update.mutate({ bigqueryProjects: [...new Set([...(prefs.data?.bigqueryProjects ?? []), p])] });
          setAdding('');
        }}
      >
        <Field label="Add a project" className="flex-1">
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="bigquery-public-data" mono />
        </Field>
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
    </aside>
  );
}

function CreateDatasetDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [datasetId, setId] = useState('');
  const [location, setLocation] = useState('US');
  const [description, setDescription] = useState('');
  const [expiration, setExpiration] = useState('');
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () =>
      api(`${bqBase(projectId)}/datasets`, {
        body: { datasetId, location, description, defaultTableExpirationDays: expiration ? Number(expiration) : undefined },
      }),
    onSuccess: () => {
      toast.success(`Created dataset ${datasetId}`);
      void client.invalidateQueries({ queryKey: ['bigquery', profileId, projectId] });
      onOpenChange(false);
      void navigate({ to: datasetHref(projectId, projectId, datasetId) });
    },
    onError: failed('Creating the dataset'),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create dataset"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!/^[A-Za-z0-9_]{1,1024}$/.test(datasetId)}
            disabledReason="Letters, digits and underscores"
            onClick={() => create.mutate()}
          >
            Create dataset
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Dataset ID" help="Letters, digits and underscores.">
          <Input value={datasetId} onChange={(e) => setId(e.target.value)} mono />
        </Field>
        <Field label="Location" help="A multi-region (US, EU) or a region (us-central1). It cannot change later.">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} mono />
        </Field>
        <Field label="Default table expiration (days)" help="Empty keeps tables until they are deleted.">
          <Input value={expiration} onChange={(e) => setExpiration(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <EquivalentCommand gcloud={`bq --location=${location} mk --dataset ${projectId}:${datasetId || 'DATASET'}`} />
      </div>
    </Dialog>
  );
}

// ---- Job history -----------------------------------------------------------------------------

function JobHistory({ projectId, onOpen }: { projectId: string; onOpen: (j: BqJobSummary) => void }) {
  const [state, setState] = useSearchState<string>('jstate', 'any', ['any', 'done', 'running', 'pending']);
  const [mine, setMine] = useState(false);
  const { profile } = useActiveProfile();
  const q = useJobs(projectId, state, mine ? (profile?.principal ?? undefined) : undefined);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const columns: ResourceColumn<BqJobSummary>[] = [
    {
      id: 'state',
      header: 'State',
      width: '7rem',
      cell: (j) => (
        <StatusGlyph
          kind={j.state !== 'DONE' ? 'running' : j.error ? 'error' : 'ok'}
          label={j.state !== 'DONE' ? j.state.toLowerCase() : j.error ? 'Failed' : 'Done'}
        />
      ),
    },
    { id: 'type', header: 'Type', width: '6rem', cell: (j) => j.type.toLowerCase() },
    {
      id: 'query',
      header: 'Query',
      cell: (j) => <span className="block max-w-[36rem] truncate font-mono text-[11px]">{j.query ?? j.jobId}</span>,
    },
    { id: 'user', header: 'By', width: '14rem', cell: (j) => <Mono value={j.user ?? ''} /> },
    { id: 'bytes', header: 'Billed', width: '7rem', align: 'right', cell: (j) => formatBqBytes(j.totalBytesBilled) },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (j) => j.createTime ?? '',
      cell: (j) => <Timestamp iso={j.createTime} />,
    },
  ];
  return (
    <div className="pt-3">
      {q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <DelayedSkeleton />
      ) : (
        <ResourceTable
          tableId="bq-jobs"
          label="Jobs"
          rows={rows}
          columns={columns}
          getRowId={(j) => `${j.location}/${j.jobId}`}
          onOpen={onOpen}
          emptyTitle="No jobs"
          emptyText="Queries, loads, copies and exports of the project appear here."
          hasMore={q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Field label="State" className="w-40">
                <Select<string>
                  value={state}
                  onValueChange={setState}
                  options={[
                    { value: 'any', label: 'Any' },
                    { value: 'running', label: 'Running' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'done', label: 'Done' },
                  ]}
                />
              </Field>
              <Switch label="Only mine" checked={mine} onCheckedChange={setMine} />
            </div>
          }
        />
      )}
    </div>
  );
}

// ---- Page ------------------------------------------------------------------------------------

const TABS = [
  { key: 'editor', label: 'Editor' },
  { key: 'jobs', label: 'Job history' },
  { key: 'scheduled', label: 'Scheduled queries' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** BigQuery (SPEC-0008 D-01 to D-04): explorer, priced SQL editor, typed results, jobs. */
export function BigQueryPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'editor',
    TABS.map((t) => t.key),
  );
  const [jobParam, setJobParam] = useSearchState<string>('job', '');
  const [sqlParam, setSqlParam] = useSearchState<string>('sql', '');
  const [sql, setSql] = useState(sqlParam || 'SELECT\n  CURRENT_TIMESTAMP() AS now');
  const [creating, setCreating] = useState(false);
  const readOnly = useReadOnly();
  useEffect(() => {
    document.title = 'BigQuery · Nephoscope';
  }, []);
  // A query passed in the address (from a table page or the Logs Explorer) fills the editor once.
  useEffect(() => {
    if (sqlParam) {
      setSql(sqlParam);
      setSqlParam('');
    }
  }, [sqlParam, setSqlParam]);
  const [location, jobId] = jobParam.includes('/') ? jobParam.split('/') : ['', ''];
  const job: BqJobRef | null = jobId ? { projectId, location: location ?? '', jobId } : null;
  const openJob = (ref: { location: string; jobId: string }) => setJobParam(`${ref.location}/${ref.jobId}`);
  return (
    <div className="pb-16">
      <TitleBlock title="BigQuery" subtitle="Every query is priced before it runs and runs under a ceiling on bytes billed." />
      <div className="grid border-t border-rule md:grid-cols-[18rem_1fr]">
        <Explorer
          projectId={projectId}
          readOnly={readOnly}
          onCreate={() => setCreating(true)}
          onQuery={(q) => {
            setSql(q);
            setTab('editor');
          }}
        />
        <div className="min-w-0">
          <TabNav label="BigQuery sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
          {tab === 'editor' ? (
            <div className="flex flex-col gap-4 pt-3">
              <QueryEditor projectId={projectId} sql={sql} onSqlChange={setSql} onJob={openJob} />
              {job ? <JobResults key={job.jobId} projectId={projectId} job={job} /> : null}
            </div>
          ) : null}
          {tab === 'jobs' ? (
            <JobHistory
              projectId={projectId}
              onOpen={(j) => {
                if (j.query) setSql(j.query);
                openJob(j);
                setTab('editor');
              }}
            />
          ) : null}
          {tab === 'scheduled' ? <KitTable projectId={projectId} collectionKey="bigquery/scheduled" readOnly={readOnly} /> : null}
        </div>
      </div>
      <CreateDatasetDialog projectId={projectId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// ---- Dataset and table pages ---------------------------------------------------------------

const daysOf = (ms: string | null) => (ms ? String(Math.round(Number(ms) / 86_400_000)) : '');

const TABLE_TEMPLATE = `[
  { "name": "id", "type": "INT64", "mode": "REQUIRED" },
  { "name": "name", "type": "STRING" },
  { "name": "created", "type": "TIMESTAMP" }
]`;

/** A dataset: details, tables, and its management actions (SPEC-0008 D-01). */
export function BqDatasetPage() {
  const { projectId, dsProject, dataset } = useParams({ strict: false }) as { projectId: string; dsProject: string; dataset: string };
  const d = useDataset(projectId, dsProject, dataset);
  const tables = useTables(projectId, dsProject, dataset);
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tableId, setTableId] = useState('');
  const [schema, setSchema] = useState(TABLE_TEMPLATE);
  const [tableCount, setTableCount] = useState('');
  const invalidate = () => void client.invalidateQueries({ queryKey: ['bigquery', profileId, projectId] });
  const createTable = useMutation({
    mutationFn: () => api(`${datasetApi(projectId, dsProject, dataset)}/tables`, { body: { tableId, schemaJson: schema } }),
    onSuccess: () => {
      toast.success(`Created table ${tableId}`);
      setCreating(false);
      invalidate();
      void navigate({ to: tableHref(projectId, dsProject, dataset, tableId) });
    },
    onError: failed('Creating the table'),
  });
  if (d.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (d.error instanceof ApiError || !d.data)
    return d.error instanceof ApiError ? <ProblemState problem={d.error.problem} onRetry={() => void d.refetch()} /> : null;
  const ds = d.data;
  const count = tables.data?.length ?? 0;
  const columns: ResourceColumn<BqTableSummary>[] = [
    {
      id: 'name',
      header: 'Table',
      hideable: false,
      sortValue: (t) => t.tableId,
      cell: (t) => (
        <Link
          to={tableHref(projectId, dsProject, dataset, t.tableId) as string}
          className="font-mono text-[12px] text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {t.tableId}
        </Link>
      ),
    },
    { id: 'type', header: 'Type', width: '10rem', cell: (t) => TYPE_LABEL[t.type] ?? t.type },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (t) => t.createTime ?? '',
      cell: (t) => <Timestamp iso={t.createTime} />,
    },
    { id: 'expires', header: 'Expires', width: '9rem', cell: (t) => <Timestamp iso={t.expirationTime} /> },
  ];
  const own = dsProject === projectId;
  return (
    <>
      <DetailLayout<'tables' | 'details'>
        crumbs={[{ label: 'BigQuery', to: `/p/${projectId}/bigquery` }, { label: dsProject }, { label: dataset }]}
        title={dataset}
        subtitle={ds.description ?? undefined}
        cells={[
          { label: 'Location', value: ds.location, mono: true },
          { label: 'Tables', value: String(count) },
          { label: 'Default expiration', value: ds.defaultTableExpirationMs ? `${daysOf(ds.defaultTableExpirationMs)} days` : 'None' },
        ]}
        actions={
          own ? (
            <Button
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => {
                setTableId('');
                setSchema(TABLE_TEMPLATE);
                setCreating(true);
              }}
            >
              Create table
            </Button>
          ) : undefined
        }
        menu={
          own ? (
            <>
              <MenuItem disabled={!!readOnly} onClick={() => setEditing(true)}>
                Edit dataset
              </MenuItem>
              <MenuItem disabled={!!readOnly} onClick={() => setDeleting(true)} className="text-redline-ink">
                Delete dataset
              </MenuItem>
            </>
          ) : undefined
        }
        tabs={[
          { key: 'tables', label: 'Tables' },
          { key: 'details', label: 'Details' },
        ]}
        defaultTab="tables"
      >
        {(tab) =>
          tab === 'details' ? (
            <div className="py-5">
              <FactList
                facts={[
                  ['Dataset', <Mono key="i" value={`${ds.projectId}.${ds.datasetId}`} copy />],
                  ['Location', ds.location],
                  ['Description', ds.description ?? ''],
                  ['Default table expiration', ds.defaultTableExpirationMs ? `${daysOf(ds.defaultTableExpirationMs)} days` : 'None'],
                  [
                    'Labels',
                    Object.entries(ds.labels)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', '),
                  ],
                  ['Created', <Timestamp key="c" iso={ds.createTime} />],
                  ['Modified', <Timestamp key="m" iso={ds.modifiedTime} />],
                ]}
              />
            </div>
          ) : (
            <div className="pt-3">
              <ResourceTable
                tableId="bq-tables"
                label="Tables"
                rows={tables.data ?? []}
                columns={columns}
                getRowId={(t) => t.tableId}
                onOpen={(t) => void navigate({ to: tableHref(projectId, dsProject, dataset, t.tableId) })}
                emptyTitle="No tables"
              />
            </div>
          )
        }
      </DetailLayout>
      <PropertiesDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${dataset}`}
        saveLabel="Save dataset"
        initial={{ description: ds.description ?? '', labels: ds.labels, expirationDays: daysOf(ds.defaultTableExpirationMs) }}
        expirationLabel="Default table expiration (days)"
        expirationHelp="Applies to tables created from now on. Empty removes it."
        onSave={async (v) => {
          await api(datasetApi(projectId, dsProject, dataset), {
            method: 'PATCH',
            body: {
              description: v.description,
              defaultTableExpirationDays: v.expirationDays,
              labels: bqLabelChanges(ds.labels, v.labels),
              etag: ds.etag ?? undefined,
            },
          });
          toast.success(`Saved ${dataset}`);
          invalidate();
        }}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create table"
        width="lg"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={createTable.isPending}
              disabled={!tableId.trim()}
              disabledReason="Name the table"
              onClick={() => createTable.mutate()}
            >
              Create table
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Table ID">
            <Input value={tableId} onChange={(e) => setTableId(e.target.value)} mono />
          </Field>
          {/* The schema editor holds several controls, each labelled, so it has a heading, not a Field label. */}
          <section aria-labelledby="bq-schema-heading" className="flex flex-col gap-1">
            <h3 id="bq-schema-heading" className="m-0 text-dense font-medium text-ink">
              Schema
            </h3>
            <p className="m-0 text-meta text-ink-3">
              Fields as rows, or the JSON that bq show --schema prints. Nested fields are edited in the JSON view.
            </p>
            <SchemaEditor value={schema} onChange={setSchema} />
          </section>
          <EquivalentCommand gcloud={`bq mk --table ${dsProject}:${dataset}.${tableId || 'TABLE'} ./schema.json`} />
        </div>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete dataset"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={tableCount.trim() !== String(count) && count > 0}
              disabledReason={`Type ${count}`}
              onClick={async () => {
                try {
                  await api(datasetApi(projectId, dsProject, dataset), { method: 'DELETE', body: { confirm: dataset, tables: count } });
                  toast.success(`Deleted ${dataset}`);
                  invalidate();
                  void navigate({ to: `/p/${projectId}/bigquery` });
                } catch (err) {
                  failed('Deleting the dataset')(err);
                }
              }}
            >
              Delete dataset
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-dense text-ink">
            {count > 0 ? `The dataset and its ${count} tables are deleted, with all their data.` : 'The empty dataset is deleted.'} This
            cannot be undone.
          </p>
          {count > 0 ? (
            <Field label={`Type ${count}, the number of tables, to confirm`}>
              <Input value={tableCount} onChange={(e) => setTableCount(e.target.value)} inputMode="numeric" autoComplete="off" />
            </Field>
          ) : null}
          <EquivalentCommand gcloud={`bq rm -r -d ${dsProject}:${dataset}`} />
        </div>
      </Dialog>
    </>
  );
}

function SchemaTree({ fields, depth = 0 }: { fields: BqField[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'm-0 flex list-none flex-col p-0' : 'm-0 flex list-none flex-col border-l border-rule pl-4'}>
      {fields.map((f) => (
        <li key={f.name} className="py-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[12px] font-medium text-ink">{f.name}</span>
            <span className="font-mono text-[11px] text-ink-2">{f.mode === 'REPEATED' ? `ARRAY<${f.type}>` : f.type}</span>
            {f.mode === 'REQUIRED' ? <span className="text-[11px] text-ink-3">required</span> : null}
            {f.policyTags.length ? (
              <span className="text-[11px] text-ink-3">policy tag {f.policyTags.map((t) => t.split('/').pop()).join(', ')}</span>
            ) : null}
            {f.description ? <span className="text-meta text-ink-2">{f.description}</span> : null}
          </span>
          {f.fields.length ? <SchemaTree fields={f.fields} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** A table or view: schema, details, a free preview, the view's SQL, copy and delete (SPEC-0008 D-01). */
export function BqTablePage() {
  const { projectId, dsProject, dataset, table } = useParams({ strict: false }) as {
    projectId: string;
    dsProject: string;
    dataset: string;
    table: string;
  };
  const t = useTable(projectId, dsProject, dataset, table);
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const [viewSql, setViewSql] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dest, setDest] = useState({ datasetId: dataset, tableId: `${table}_copy`, writeDisposition: 'WRITE_EMPTY' });
  const isView = t.data?.type === 'VIEW';
  const preview = usePaged(
    projectId,
    ['preview', dsProject, dataset, table],
    `${tableApi(projectId, dsProject, dataset, table)}/preview`,
    !!t.data && !isView && t.data.type !== 'MATERIALIZED_VIEW',
    100,
  );
  const rows = useMemo(() => (preview.data?.pages ?? []).flatMap((p) => p.rows) as BqValue[][], [preview.data]);
  useEffect(() => {
    if (t.data?.schema)
      queryHints.sql.columns = [...new Set([...queryHints.sql.columns, ...t.data.schema.map((f) => f.name)])].slice(-2000);
  }, [t.data]);
  const saveView = useMutation({
    mutationFn: () =>
      api(tableApi(projectId, dsProject, dataset, table), {
        method: 'PATCH',
        body: { viewQuery: viewSql ?? '', etag: t.data?.etag ?? undefined },
      }),
    onSuccess: () => {
      toast.success(`Updated view ${table}`);
      setViewSql(null);
      void client.invalidateQueries({ queryKey: ['bigquery', profileId, projectId] });
    },
    onError: failed('Updating the view'),
  });
  const copy = useMutation({
    mutationFn: () => api<OperationAccepted>(`${tableApi(projectId, dsProject, dataset, table)}/copy`, { body: dest }),
    onSuccess: (r) => {
      useOperations.getState().upsert(r.operation);
      toast(`Copying ${table}`, { description: 'Follow it in the operations tray.' });
      setCopying(false);
    },
    onError: failed('Copying the table'),
  });
  if (t.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (t.error instanceof ApiError || !t.data)
    return t.error instanceof ApiError ? <ProblemState problem={t.error.problem} onRetry={() => void t.refetch()} /> : null;
  const tv = t.data;
  const own = dsProject === projectId;
  const query = () =>
    void navigate({
      to: `/p/${projectId}/bigquery` as string,
      search: { sql: `SELECT *\nFROM ${quoted(dsProject, dataset, table)}\nLIMIT 100` },
    });
  return (
    <>
      <DetailLayout<'schema' | 'details' | 'preview' | 'sql'>
        crumbs={[
          { label: 'BigQuery', to: `/p/${projectId}/bigquery` },
          { label: dataset, to: datasetHref(projectId, dsProject, dataset) },
          { label: table },
        ]}
        title={table}
        subtitle={TYPE_LABEL[tv.type] ?? tv.type}
        cells={[
          { label: 'Rows', value: tv.numRows ? Number(tv.numRows).toLocaleString() : '' },
          { label: 'Logical size', value: formatBqBytes(tv.logicalBytes) },
          { label: 'Location', value: tv.location ?? '', mono: true },
        ]}
        actions={
          <Button variant="commit" onClick={query}>
            Query table
          </Button>
        }
        menu={
          <>
            {own ? (
              <MenuItem disabled={!!readOnly} onClick={() => setEditing(true)}>
                Edit {isView ? 'view' : 'table'} properties
              </MenuItem>
            ) : null}
            <MenuItem disabled={!!readOnly || isView} onClick={() => setCopying(true)}>
              Copy table
            </MenuItem>
            {own ? (
              <MenuItem disabled={!!readOnly} onClick={() => setDeleting(true)} className="text-redline-ink">
                Delete {isView ? 'view' : 'table'}
              </MenuItem>
            ) : null}
          </>
        }
        tabs={[
          { key: 'schema', label: 'Schema' },
          { key: 'details', label: 'Details' },
          ...(isView || tv.type === 'MATERIALIZED_VIEW'
            ? [{ key: 'sql' as const, label: 'SQL' }]
            : [{ key: 'preview' as const, label: 'Preview' }]),
        ]}
        defaultTab="schema"
      >
        {(tab) =>
          tab === 'schema' ? (
            <div className="px-6 py-4">
              <SchemaTree fields={tv.schema} />
            </div>
          ) : tab === 'details' ? (
            <div className="py-5">
              <FactList
                facts={[
                  ['Table', <Mono key="i" value={`${tv.projectId}.${tv.datasetId}.${tv.tableId}`} copy />],
                  ['Description', tv.description ?? ''],
                  ['Rows', tv.numRows ? Number(tv.numRows).toLocaleString() : ''],
                  ['Logical size', formatBqBytes(tv.logicalBytes)],
                  ['Physical size', formatBqBytes(tv.physicalBytes)],
                  ['Long-term storage', formatBqBytes(tv.longTermBytes)],
                  ['Partitioning', tv.partitioning ?? 'None'],
                  ['Clustering', tv.clustering.join(', ') || 'None'],
                  ['Expires', <Timestamp key="e" iso={tv.expirationTime} />],
                  ['External sources', tv.externalUris.join(', ')],
                  [
                    'Labels',
                    Object.entries(tv.labels)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', '),
                  ],
                  ['Created', <Timestamp key="c" iso={tv.createTime} />],
                  ['Modified', <Timestamp key="m" iso={tv.modifiedTime} />],
                ]}
              />
            </div>
          ) : tab === 'sql' ? (
            <div className="flex flex-col gap-3 px-6 py-4">
              <CodeEditor
                value={viewSql ?? tv.viewQuery ?? tv.materializedQuery ?? ''}
                onChange={isView && own ? setViewSql : undefined}
                readOnly={!isView || !own || !!readOnly}
                language="googlesql"
                height={320}
                label="View SQL"
              />
              {isView && own ? (
                <span className="flex gap-2">
                  <Button
                    variant="commit"
                    disabled={viewSql === null || !!readOnly}
                    disabledReason={readOnly ?? 'Edit the SQL first'}
                    loading={saveView.isPending}
                    onClick={() => saveView.mutate()}
                  >
                    Save view
                  </Button>
                  {viewSql !== null ? <Button onClick={() => setViewSql(null)}>Discard</Button> : null}
                </span>
              ) : null}
            </div>
          ) : (
            <Section title="Preview" description="Rows read with tabledata.list: no query runs and nothing is billed.">
              {preview.isPending ? (
                <DelayedSkeleton rows={6} />
              ) : preview.error instanceof ApiError ? (
                <ProblemState problem={preview.error.problem} onRetry={() => void preview.refetch()} />
              ) : (
                <ResultsGrid
                  schema={preview.data?.pages[0]?.schema ?? tv.schema}
                  rows={rows}
                  label={`Preview of ${table}`}
                  total={tv.numRows ? Number(tv.numRows) : null}
                  hasMore={preview.hasNextPage}
                  loadingMore={preview.isFetchingNextPage}
                  onLoadMore={() => void preview.fetchNextPage()}
                />
              )}
            </Section>
          )
        }
      </DetailLayout>
      <Dialog
        open={copying}
        onOpenChange={setCopying}
        title={`Copy ${table}`}
        footer={
          <>
            <Button onClick={() => setCopying(false)}>Cancel</Button>
            <Button variant="commit" loading={copy.isPending} onClick={() => copy.mutate()}>
              Copy table
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Destination dataset" help={`In ${projectId}.`}>
            <Input value={dest.datasetId} onChange={(e) => setDest({ ...dest, datasetId: e.target.value })} mono />
          </Field>
          <Field label="Destination table">
            <Input value={dest.tableId} onChange={(e) => setDest({ ...dest, tableId: e.target.value })} mono />
          </Field>
          <Field label="If the table exists">
            <Select<string>
              value={dest.writeDisposition}
              onValueChange={(writeDisposition) => setDest({ ...dest, writeDisposition })}
              options={[
                { value: 'WRITE_EMPTY', label: 'Fail' },
                { value: 'WRITE_TRUNCATE', label: 'Replace it' },
                { value: 'WRITE_APPEND', label: 'Append to it' },
              ]}
            />
          </Field>
          <EquivalentCommand gcloud={`bq cp ${dsProject}:${dataset}.${table} ${projectId}:${dest.datasetId}.${dest.tableId}`} />
        </div>
      </Dialog>
      <PropertiesDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${table}`}
        saveLabel={`Save ${isView ? 'view' : 'table'}`}
        initial={{
          description: tv.description ?? '',
          labels: tv.labels,
          expirationDays: tv.expirationTime
            ? String(Math.max(1, Math.ceil((Date.parse(tv.expirationTime) - Date.now()) / 86_400_000)))
            : '',
        }}
        expirationLabel="Expires in (days)"
        expirationHelp="Counted from now. Empty keeps the table until it is deleted."
        onSave={async (v) => {
          await api(tableApi(projectId, dsProject, dataset, table), {
            method: 'PATCH',
            body: {
              description: v.description,
              expirationTime: v.expirationDays === null ? null : String(Date.now() + v.expirationDays * 86_400_000),
              labels: bqLabelChanges(tv.labels, v.labels),
              etag: tv.etag ?? undefined,
            },
          });
          toast.success(`Saved ${table}`);
          void client.invalidateQueries({ queryKey: ['bigquery', profileId, projectId] });
        }}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${isView ? 'view' : 'table'}`}
        consequence={
          isView
            ? 'The view is deleted; the tables it reads are kept.'
            : 'The table and all its rows are deleted. Time travel may still restore it for a few days.'
        }
        expected={table}
        confirmLabel={`Delete ${isView ? 'view' : 'table'}`}
        command={`bq rm -t ${dsProject}:${dataset}.${table}`}
        onConfirm={async (confirm) => {
          await api(tableApi(projectId, dsProject, dataset, table), { method: 'DELETE', body: { confirm } });
          toast.success(`Deleted ${table}`);
          void client.invalidateQueries({ queryKey: ['bigquery', profileId, projectId] });
          void navigate({ to: datasetHref(projectId, dsProject, dataset) });
        }}
      />
    </>
  );
}
