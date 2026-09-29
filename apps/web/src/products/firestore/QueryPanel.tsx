import type {
  AggregationResult,
  ExplainMetrics,
  ExplainMode,
  FieldOperator,
  FirestoreDocument,
  FirestoreListenUpdate,
  IndexDefinition,
  Problem,
  QuerySpec,
  UnaryOperator,
  WireValue,
} from '@nephoscope/contracts';
import { previewValue, printExportLine, WIRE_TYPE_LABELS } from '@nephoscope/contracts/firestore-value';
import {
  BroadcastIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  ListNumbersIcon,
  PlayIcon,
  PlusIcon,
  SigmaIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono } from '../../design/Values';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { download } from '../../lib/download';
import { live } from '../../lib/live';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';
import { documentsRoot, runAggregation, runQuery, useCreateIndex } from './api';
import { type CodeLanguage, codeLanguages, queryCode } from './code';
import type { DbContext } from './Documents';
import {
  ARRAY_OPS,
  type Draft,
  type DraftErrors,
  type DraftGroup,
  type DraftNode,
  describeSpec,
  draftAggregations,
  draftToSpec,
  isGroup,
  newDraft,
  newId,
  specToDraft,
} from './query-draft';

const FIELD_OPS: { value: FieldOperator | UnaryOperator; label: string }[] = [
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: 'array-contains', label: 'array-contains' },
  { value: 'array-contains-any', label: 'array-contains-any' },
  { value: 'in', label: 'in' },
  { value: 'not-in', label: 'not-in' },
  { value: 'is-null', label: 'is null' },
  { value: 'is-not-null', label: 'is not null' },
  { value: 'is-nan', label: 'is NaN' },
  { value: 'is-not-nan', label: 'is not NaN' },
];
const UNARY = new Set<string>(['is-null', 'is-not-null', 'is-nan', 'is-not-nan']);

const historyKey = (projectId: string, databaseId: string) =>
  `firestore.queries:${projectId}:${databaseId === '(default)' ? '_default_' : databaseId}`;

function useRecentQueries(projectId: string, databaseId: string) {
  const profileId = useSession((s) => s.profileId);
  const key = historyKey(projectId, databaseId);
  return useQuery({
    queryKey: ['history', key, profileId],
    queryFn: ({ signal }) => api<string[]>(`/api/history/${encodeURIComponent(key)}`, { signal, profileId: null }),
  });
}

// ---- filter editor ----------------------------------------------------------------------------------

function updateNode(group: DraftGroup, id: string, fn: (n: DraftNode) => DraftNode | null): DraftGroup {
  const items: DraftNode[] = [];
  for (const item of group.items) {
    if (item.id === id) {
      const next = fn(item);
      if (next) items.push(next);
    } else if (isGroup(item)) items.push(updateNode(item, id, fn));
    else items.push(item);
  }
  return { ...group, items };
}

function ConditionRow({
  node,
  error,
  onChange,
  onRemove,
}: {
  node: Extract<DraftNode, { kind: 'field' | 'unary' }>;
  error?: string;
  onChange: (n: DraftNode) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[minmax(8rem,14rem)_10rem_minmax(0,1fr)_auto] items-center gap-2">
        <Input
          mono
          value={node.field}
          onChange={(e) => onChange({ ...node, field: e.target.value })}
          placeholder="field.path"
          aria-label="Field"
          aria-invalid={!!error || undefined}
        />
        <Select<FieldOperator | UnaryOperator>
          value={node.op}
          aria-label="Operator"
          options={FIELD_OPS}
          onValueChange={(op) =>
            onChange(
              UNARY.has(op)
                ? { id: node.id, kind: 'unary', field: node.field, op: op as UnaryOperator }
                : {
                    id: node.id,
                    kind: 'field',
                    field: node.field,
                    op: op as FieldOperator,
                    value: node.kind === 'field' ? node.value : '',
                  },
            )
          }
        />
        {node.kind === 'field' ? (
          <Input
            mono
            value={node.value}
            onChange={(e) => onChange({ ...node, value: e.target.value })}
            placeholder={ARRAY_OPS.includes(node.op) ? '["a", "b"]' : '"text", 12, 1.5, true, {"$timestamp": "…"}'}
            aria-label="Value"
            aria-invalid={!!error || undefined}
          />
        ) : (
          <span />
        )}
        <IconButton icon={XIcon} label="Remove condition" size="sm" onClick={onRemove} />
      </div>
      {error ? <span className="text-meta text-redline-ink">{error}</span> : null}
    </div>
  );
}

function GroupEditor({
  group,
  errors,
  onChange,
  onRemove,
  depth,
}: {
  group: DraftGroup;
  errors: DraftErrors;
  onChange: (g: DraftGroup) => void;
  onRemove?: () => void;
  depth: number;
}) {
  const set = (id: string, fn: (n: DraftNode) => DraftNode | null) => onChange(updateNode(group, id, fn));
  return (
    <div className={cn('flex flex-col gap-2', depth > 0 && 'border-l-2 border-rule-strong pl-3')}>
      <div className="flex items-center gap-2">
        <Select<'and' | 'or'>
          value={group.kind}
          onValueChange={(kind) => onChange({ ...group, kind })}
          aria-label="Combine conditions with"
          options={[
            { value: 'and', label: 'All of (AND)' },
            { value: 'or', label: 'Any of (OR)' },
          ]}
          className="w-36"
        />
        <Button
          size="sm"
          variant="ghost"
          icon={PlusIcon}
          onClick={() => onChange({ ...group, items: [...group.items, { id: newId(), kind: 'field', field: '', op: '==', value: '' }] })}
        >
          Condition
        </Button>
        {depth < 3 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={PlusIcon}
            onClick={() =>
              onChange({ ...group, items: [...group.items, { id: newId(), kind: group.kind === 'and' ? 'or' : 'and', items: [] }] })
            }
          >
            Group
          </Button>
        ) : null}
        {onRemove ? <IconButton icon={XIcon} label="Remove group" size="sm" onClick={onRemove} /> : null}
      </div>
      {group.items.map((item) =>
        isGroup(item) ? (
          <GroupEditor
            key={item.id}
            group={item}
            errors={errors}
            depth={depth + 1}
            onChange={(g) => set(item.id, () => g)}
            onRemove={() => set(item.id, () => null)}
          />
        ) : (
          <ConditionRow
            key={item.id}
            node={item}
            error={errors[item.id]}
            onChange={(n) => set(item.id, () => n)}
            onRemove={() => set(item.id, () => null)}
          />
        ),
      )}
    </div>
  );
}

// ---- results -------------------------------------------------------------------------------------------

function ResultsTable({
  rows,
  root,
  fresh,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
}: {
  rows: FirestoreDocument[];
  root: string;
  fresh: ReadonlySet<string>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onOpen: (d: FirestoreDocument) => void;
}) {
  const fields = useMemo(() => {
    const names = new Set<string>();
    for (const d of rows) for (const k of Object.keys(d.fields)) names.add(k);
    return [...names].sort().slice(0, 40);
  }, [rows]);
  const columns: ResourceColumn<FirestoreDocument>[] = [
    {
      id: '__path',
      header: 'Document',
      hideable: false,
      width: '16rem',
      sortValue: (d) => d.path,
      cell: (d) => <span className="font-mono text-[12px] text-ink">{d.path}</span>,
    },
    ...fields.map(
      (f): ResourceColumn<FirestoreDocument> => ({
        id: `f:${f}`,
        header: f,
        width: '11rem',
        sortValue: (d) => (d.fields[f] ? previewValue(d.fields[f] as WireValue) : null),
        cell: (d) => {
          const v = d.fields[f];
          return v ? <span className="font-mono text-[12px]">{previewValue(v, root, 60)}</span> : null;
        },
      }),
    ),
  ];
  return (
    <ResourceTable
      tableId="firestore-query-results"
      label="Query results"
      rows={rows}
      columns={columns}
      getRowId={(d) => d.name}
      onOpen={onOpen}
      rowClassName={(d) => (fresh.has(d.name) ? 'nb-ink-fresh' : undefined)}
      emptyTitle="No documents match"
      emptyText="Nothing matched this query. Loosen a filter, or check the field names and value types: 1 and 1.0 match, but 1 and &quot;1&quot; do not."
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  );
}

function ExplainView({ explain }: { explain: ExplainMetrics }) {
  return (
    <Section title="Explain" description="How Firestore ran the query.">
      <div className="flex flex-col gap-3 px-6">
        <div>
          <Legend>Indexes used</Legend>
          {explain.indexesUsed.length === 0 ? (
            <p className="m-0 text-meta text-ink-3">None reported.</p>
          ) : (
            <ul className="m-0 list-none p-0 font-mono text-[12px]">
              {explain.indexesUsed.map((ix) => (
                <li key={JSON.stringify(ix)}>
                  {String(ix.query_scope ?? '')} {String(ix.properties ?? JSON.stringify(ix))}
                </li>
              ))}
            </ul>
          )}
        </div>
        {explain.stats ? (
          <dl className="m-0 grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-dense">
            <dt className="text-ink-3">Results returned</dt>
            <dd className="m-0 tnum">{explain.stats.resultsReturned ?? ''}</dd>
            <dt className="text-ink-3">Reads billed</dt>
            <dd className="m-0 tnum">{explain.stats.readOperations ?? ''}</dd>
            <dt className="text-ink-3">Execution time</dt>
            <dd className="m-0 tnum">{explain.stats.executionDuration ?? ''}</dd>
          </dl>
        ) : (
          <p className="m-0 text-meta text-ink-3">Plan only: the query was not run. Use Analyze for reads and timing.</p>
        )}
        {explain.stats?.debugStats ? (
          <table className="w-full max-w-xl border-collapse text-dense">
            <tbody>
              {Object.entries(explain.stats.debugStats).map(([k, v]) => (
                <tr key={k} className="border-t border-rule">
                  <td className="py-1 pr-4 text-ink-2">{k}</td>
                  <td className="tnum py-1 font-mono text-[12px]">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Section>
  );
}

function IndexSuggestion({
  ctx,
  index,
  derived,
  onCreated,
}: {
  ctx: DbContext;
  index: IndexDefinition;
  derived: boolean;
  onCreated: (operationId: string) => void;
}) {
  const create = useCreateIndex(ctx.projectId, ctx.databaseId);
  return (
    <Section
      title="This query needs a composite index"
      description={derived ? 'Read from the query, since Google did not send an index definition.' : 'Decoded from Google’s error.'}
    >
      <div className="flex flex-col gap-3 px-6">
        <dl className="m-0 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-dense">
          <dt className="text-ink-3">Collection group</dt>
          <dd className="m-0 font-mono text-[12px]">{index.collectionGroup}</dd>
          <dt className="text-ink-3">Query scope</dt>
          <dd className="m-0">{index.queryScope === 'COLLECTION_GROUP' ? 'Collection group' : 'Collection'}</dd>
          <dt className="text-ink-3">Fields</dt>
          <dd className="m-0 font-mono text-[12px]">
            {index.fields
              .filter((f) => f.fieldPath !== '__name__')
              .map(
                (f) =>
                  `${f.fieldPath} ${f.arrayConfig ? 'array-contains' : f.vectorDimension ? `vector(${f.vectorDimension})` : f.order === 'DESCENDING' ? 'desc' : 'asc'}`,
              )
              .join(', ')}
          </dd>
        </dl>
        <div>
          <Button
            variant="commit"
            icon={ListNumbersIcon}
            loading={create.isPending}
            disabled={!!ctx.readOnly}
            disabledReason={ctx.readOnly}
            onClick={() =>
              create.mutate(
                {
                  collectionGroup: index.collectionGroup,
                  queryScope: index.queryScope,
                  fields: index.fields.filter((f) => f.fieldPath !== '__name__'),
                },
                { onSuccess: (r) => onCreated(r.operation.id) },
              )
            }
          >
            Create index
          </Button>
          <p className="mt-1 mb-0 text-meta text-ink-3">Building takes a few minutes. The query runs again when the index is ready.</p>
        </div>
      </div>
    </Section>
  );
}

// ---- export ------------------------------------------------------------------------------------------------

function flatten(prefix: string, v: WireValue, out: Record<string, string>, root: string) {
  if (v.t === 'map') for (const [k, x] of Object.entries(v.v)) flatten(prefix ? `${prefix}.${k}` : k, x, out, root);
  else out[prefix] = v.t === 'string' ? v.v : previewValue(v, root, 100_000);
}

function toCsv(rows: FirestoreDocument[], root: string): string {
  const flat = rows.map((d) => {
    const out: Record<string, string> = { __path__: d.path };
    for (const [k, v] of Object.entries(d.fields)) flatten(k, v, out, root);
    return out;
  });
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const cell = (s: string | undefined) => (s === undefined ? '' : /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return [cols.map(cell).join(','), ...flat.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

// ---- panel ---------------------------------------------------------------------------------------------------

type Outcome =
  | {
      kind: 'documents';
      spec: QuerySpec;
      rows: FirestoreDocument[];
      nextCursor: WireValue[] | null;
      explain: ExplainMetrics | null;
      readTime: string | null;
    }
  | { kind: 'aggregation'; result: AggregationResult; labels: string[] }
  | { kind: 'problem'; problem: Problem; spec: QuerySpec };

/** The query builder (SPEC-0004 D-06 to D-10, D-16, CA-12 to CA-15). */
export function QueryPanel({ ctx, openPath }: { ctx: DbContext; openPath: (path: string) => void }) {
  const root = documentsRoot(ctx.projectId, ctx.databaseId);
  const [saved, setSaved] = useSearchState<string>('q', '');
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return saved ? (JSON.parse(saved) as Draft) : newDraft();
    } catch {
      return newDraft();
    }
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveOn, setLiveOn] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [reads, setReads] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [codeLang, setCodeLang] = useState<CodeLanguage | null>(null);
  const [pendingIndexOp, setPendingIndexOp] = useState<string | null>(null);
  const recent = useRecentQueries(ctx.projectId, ctx.databaseId);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const liveRows = useRef(new Map<string, FirestoreDocument>());

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const remember = useCallback(
    (spec: QuerySpec) => {
      setSaved(JSON.stringify(draft));
      const key = historyKey(ctx.projectId, ctx.databaseId);
      void api(`/api/history/${encodeURIComponent(key)}`, { body: { value: JSON.stringify(spec) }, profileId: null }).then(() =>
        client.invalidateQueries({ queryKey: ['history', key] }),
      );
    },
    [draft, ctx.projectId, ctx.databaseId, setSaved, client],
  );

  const run = async (explain?: ExplainMode) => {
    const r = draftToSpec(draft, root);
    setErrors(r.ok ? {} : r.errors);
    if (!r.ok) return;
    setLiveOn(false);
    setBusy(true);
    try {
      const res = await runQuery(ctx.projectId, ctx.databaseId, r.spec, explain);
      setOutcome({
        kind: 'documents',
        spec: r.spec,
        rows: res.documents,
        nextCursor: res.nextCursor,
        explain: res.explain,
        readTime: res.readTime,
      });
      remember(r.spec);
    } catch (err) {
      if (err instanceof ApiError) setOutcome({ kind: 'problem', problem: err.problem, spec: r.spec });
      else throw err;
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (outcome?.kind !== 'documents' || !outcome.nextCursor) return;
    setBusy(true);
    try {
      const spec = { ...outcome.spec, start: { mode: 'after' as const, values: outcome.nextCursor }, offset: undefined };
      const res = await runQuery(ctx.projectId, ctx.databaseId, spec);
      setOutcome({ ...outcome, rows: [...outcome.rows, ...res.documents], nextCursor: res.nextCursor });
    } catch (err) {
      toast.error('Loading more failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const aggregate = async (explain?: ExplainMode) => {
    const r = draftToSpec(draft, root);
    const a = draftAggregations(draft);
    setErrors({ ...(r.ok ? {} : r.errors), ...(a.ok ? {} : a.errors) });
    if (!r.ok || !a.ok) return;
    setLiveOn(false);
    setBusy(true);
    try {
      const result = await runAggregation(ctx.projectId, ctx.databaseId, { ...r.spec, limit: r.spec.limit }, a.aggregations, explain);
      setOutcome({
        kind: 'aggregation',
        result,
        labels: a.aggregations.map((x) => (x.op === 'count' ? 'count()' : `${x.op}(${x.field})`)),
      });
      remember(r.spec);
    } catch (err) {
      if (err instanceof ApiError) setOutcome({ kind: 'problem', problem: err.problem, spec: r.spec });
    } finally {
      setBusy(false);
    }
  };

  // ---- live mode (D-10) ----
  const liveSpec = useMemo(() => (liveOn ? draftToSpec(draft, root, { live: true }) : null), [liveOn, draft, root]);
  useEffect(() => {
    if (!liveOn || !liveSpec?.ok || livePaused || !profileId) return;
    liveRows.current = new Map();
    setReads(0);
    const spec = liveSpec.spec;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = live.subscribe(
      'firestore.listen',
      { profileId, projectId: ctx.projectId },
      { database: ctx.databaseId, query: spec },
      {
        data(payload) {
          const u = payload as FirestoreListenUpdate;
          const changed = new Set<string>();
          for (const c of u.changes) {
            if (c.type === 'removed') liveRows.current.delete(c.document.name);
            else {
              liveRows.current.set(c.document.name, c.document);
              if (!u.initial) changed.add(c.document.name);
            }
          }
          setReads((n) => n + u.reads);
          setOutcome({
            kind: 'documents',
            spec,
            rows: [...liveRows.current.values()],
            nextCursor: null,
            explain: null,
            readTime: u.readTime,
          });
          if (changed.size > 0) {
            setFresh(changed);
            setTimeout(() => setFresh(new Set()), 1200);
          }
        },
        error(problem) {
          setLiveOn(false);
          setOutcome({ kind: 'problem', problem, spec });
        },
      },
    );
    // Resuming reads every matching document again, so live mode stops after 60 s hidden and asks first (T-10).
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenTimer = setTimeout(() => setLivePaused(true), 60_000);
      else if (hiddenTimer) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      unsubscribe();
    };
  }, [liveOn, liveSpec, livePaused, profileId, ctx.projectId, ctx.databaseId]);

  // Re-run the query when an index it needed finishes building (CA-14).
  const indexOp = useOperations((s) => (pendingIndexOp ? s.byId[pendingIndexOp] : undefined));
  // biome-ignore lint/correctness/useExhaustiveDependencies: run reads the current draft; the effect only reacts to the operation.
  useEffect(() => {
    if (indexOp?.status === 'succeeded') {
      setPendingIndexOp(null);
      toast.success('The index is ready; running the query again');
      void run();
    }
  }, [indexOp?.status]);

  const spec = draftToSpec(draft, root);
  const notes: Note[] = [];
  if (liveOn && liveSpec?.ok && !livePaused)
    notes.push({
      id: 'live',
      tone: 'info',
      text: `Live: the first snapshot read every matching document; each change costs one read. ${reads.toLocaleString('en-US')} reads so far.`,
    });
  if (livePaused)
    notes.push({
      id: 'paused',
      tone: 'warn',
      text: 'Live mode stopped after the tab was hidden for a minute. Resuming reads every matching document again.',
      action: (
        <Button size="sm" onClick={() => setLivePaused(false)}>
          Resume live mode
        </Button>
      ),
    });
  if (outcome?.kind === 'aggregation')
    notes.push({ id: 'cost', tone: 'info', text: 'Aggregations bill one read per batch of up to 1,000 index entries matched.' });

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 border-b border-rule px-6 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Legend>Source</Legend>
          <div className="flex flex-wrap items-end gap-2">
            <Select<'collection' | 'group'>
              value={draft.source}
              onValueChange={(source) => patch({ source })}
              aria-label="Source kind"
              options={[
                { value: 'collection', label: 'Collection' },
                { value: 'group', label: 'Collection group' },
              ]}
              className="w-40"
            />
            {draft.source === 'collection' ? (
              <Input
                mono
                value={draft.path}
                onChange={(e) => patch({ path: e.target.value })}
                placeholder="users/abc/orders"
                aria-label="Collection path"
                className="min-w-0 flex-1"
              />
            ) : (
              <>
                <Input
                  mono
                  value={draft.collectionId}
                  onChange={(e) => patch({ collectionId: e.target.value })}
                  placeholder="orders"
                  aria-label="Collection id"
                  className="w-40"
                />
                <Input
                  mono
                  value={draft.parent}
                  onChange={(e) => patch({ parent: e.target.value })}
                  placeholder="Under a document (optional)"
                  aria-label="Parent document"
                  className="min-w-0 flex-1"
                />
              </>
            )}
          </div>
          {errors.source ? <span className="text-meta text-redline-ink">{errors.source}</span> : null}
          <Legend>Where</Legend>
          <GroupEditor group={draft.where} errors={errors} depth={0} onChange={(where) => patch({ where })} />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Legend>Order by</Legend>
            <Button
              size="sm"
              variant="ghost"
              icon={PlusIcon}
              onClick={() => patch({ orderBy: [...draft.orderBy, { id: newId(), field: '', direction: 'asc' }] })}
            >
              Order
            </Button>
          </div>
          {draft.orderBy.map((o) => (
            <div key={o.id} className="flex flex-col gap-0.5">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-center gap-2">
                <Input
                  mono
                  value={o.field}
                  onChange={(e) => patch({ orderBy: draft.orderBy.map((x) => (x.id === o.id ? { ...x, field: e.target.value } : x)) })}
                  aria-label="Order field"
                />
                <Select<'asc' | 'desc'>
                  value={o.direction}
                  onValueChange={(direction) => patch({ orderBy: draft.orderBy.map((x) => (x.id === o.id ? { ...x, direction } : x)) })}
                  aria-label="Direction"
                  options={[
                    { value: 'asc', label: 'Ascending' },
                    { value: 'desc', label: 'Descending' },
                  ]}
                />
                <IconButton
                  icon={XIcon}
                  label="Remove order"
                  size="sm"
                  onClick={() => patch({ orderBy: draft.orderBy.filter((x) => x.id !== o.id) })}
                />
              </div>
              {errors[o.id] ? <span className="text-meta text-redline-ink">{errors[o.id]}</span> : null}
            </div>
          ))}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Limit" error={errors.limit}>
              <Input mono value={draft.limit} onChange={(e) => patch({ limit: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
            </Field>
            <Field label="Offset" error={errors.offset} help="Skipped documents are still billed.">
              <Input mono value={draft.offset} onChange={(e) => patch({ offset: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
            </Field>
            <Field label="Select fields" error={errors.select} help="Comma separated.">
              <Input mono value={draft.select} onChange={(e) => patch({ select: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" error={errors.start} help="One value per order field.">
              <div className="flex gap-2">
                <Select<'' | 'at' | 'after'>
                  value={draft.start.mode}
                  onValueChange={(mode) => patch({ start: { ...draft.start, mode } })}
                  aria-label="Start mode"
                  options={[
                    { value: '', label: 'No start' },
                    { value: 'at', label: 'At' },
                    { value: 'after', label: 'After' },
                  ]}
                  className="w-32 shrink-0"
                />
                <Input
                  mono
                  value={draft.start.values}
                  onChange={(e) => patch({ start: { ...draft.start, values: e.target.value } })}
                  placeholder='["a", 10]'
                  disabled={!draft.start.mode}
                  aria-label="Start values"
                />
              </div>
            </Field>
            <Field label="End" error={errors.end}>
              <div className="flex gap-2">
                <Select<'' | 'at' | 'before'>
                  value={draft.end.mode}
                  onValueChange={(mode) => patch({ end: { ...draft.end, mode } })}
                  aria-label="End mode"
                  options={[
                    { value: '', label: 'No end' },
                    { value: 'at', label: 'At' },
                    { value: 'before', label: 'Before' },
                  ]}
                  className="w-32 shrink-0"
                />
                <Input
                  mono
                  value={draft.end.values}
                  onChange={(e) => patch({ end: { ...draft.end, values: e.target.value } })}
                  placeholder='["z"]'
                  disabled={!draft.end.mode}
                  aria-label="End values"
                />
              </div>
            </Field>
          </div>
          <Switch
            checked={draft.nearest.enabled}
            onCheckedChange={(enabled) => patch({ nearest: { ...draft.nearest, enabled } })}
            label="Nearest neighbors"
            description="Vector search on a vector field."
          />
          {draft.nearest.enabled ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vector field">
                <Input mono value={draft.nearest.field} onChange={(e) => patch({ nearest: { ...draft.nearest, field: e.target.value } })} />
              </Field>
              <Field label="Distance measure">
                <Select<Draft['nearest']['measure']>
                  value={draft.nearest.measure}
                  onValueChange={(measure) => patch({ nearest: { ...draft.nearest, measure } })}
                  options={[
                    { value: 'COSINE', label: 'Cosine' },
                    { value: 'EUCLIDEAN', label: 'Euclidean' },
                    { value: 'DOT_PRODUCT', label: 'Dot product' },
                  ]}
                />
              </Field>
              <Field label="Query vector" error={errors.nearest}>
                <Input
                  mono
                  value={draft.nearest.vector}
                  onChange={(e) => patch({ nearest: { ...draft.nearest, vector: e.target.value } })}
                  placeholder="[0.1, 0.2, 0.3]"
                />
              </Field>
              <Field label="Neighbors">
                <Input
                  mono
                  value={draft.nearest.limit}
                  onChange={(e) => patch({ nearest: { ...draft.nearest, limit: e.target.value.replace(/\D/g, '') } })}
                />
              </Field>
              <Field label="Distance result field">
                <Input
                  mono
                  value={draft.nearest.distanceField}
                  onChange={(e) => patch({ nearest: { ...draft.nearest, distanceField: e.target.value } })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Distance threshold">
                <Input
                  mono
                  value={draft.nearest.threshold}
                  onChange={(e) => patch({ nearest: { ...draft.nearest, threshold: e.target.value } })}
                  placeholder="Optional"
                />
              </Field>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-6 py-3">
        <Button variant="commit" icon={PlayIcon} loading={busy && !liveOn} onClick={() => void run()}>
          Run query
        </Button>
        <Menu trigger={<Button icon={FunnelIcon}>Explain</Button>}>
          <MenuItem onClick={() => void run('plan')}>Plan only</MenuItem>
          <MenuItem onClick={() => void run('analyze')}>Analyze (runs the query)</MenuItem>
        </Menu>
        <Button
          icon={liveOn ? StopIcon : BroadcastIcon}
          onClick={() => {
            if (liveOn) {
              setLiveOn(false);
              return;
            }
            const r = draftToSpec(draft, root, { live: true });
            setErrors(r.ok ? {} : r.errors);
            if (r.ok) {
              setLivePaused(false);
              setLiveOn(true);
            }
          }}
        >
          {liveOn ? 'Stop live' : 'Live'}
        </Button>
        <Menu trigger={<Button icon={CodeIcon}>Copy as code</Button>}>
          {codeLanguages.map((l) => (
            <MenuItem key={l.value} onClick={() => setCodeLang(l.value)} disabled={!spec.ok}>
              {l.label}
            </MenuItem>
          ))}
        </Menu>
        <Menu trigger={<Button icon={DownloadSimpleIcon}>Export results</Button>}>
          {(['json', 'ndjson', 'csv'] as const).map((f) => (
            <MenuItem
              key={f}
              disabled={outcome?.kind !== 'documents' || outcome.rows.length === 0}
              onClick={() => {
                if (outcome?.kind !== 'documents') return;
                const rows = outcome.rows;
                if (f === 'csv') {
                  download('firestore-export.csv', toCsv(rows, root), 'text/csv');
                  toast('CSV flattens nested fields and loses value types.', { description: 'Use typed JSON to import the data again.' });
                } else if (f === 'ndjson')
                  download(
                    'firestore-export.ndjson',
                    `${rows.map((d) => printExportLine(d.id, d.fields, { documentsRoot: root, indent: 0 })).join('\n')}\n`,
                    'application/x-ndjson',
                  );
                else
                  download(
                    'firestore-export.json',
                    `[\n${rows.map((d) => printExportLine(d.id, d.fields, { documentsRoot: root, indent: 2 })).join(',\n')}\n]\n`,
                    'application/json',
                  );
              }}
            >
              {f === 'json' ? 'Typed JSON' : f === 'ndjson' ? 'Typed NDJSON' : 'CSV'}
            </MenuItem>
          ))}
        </Menu>
        <Menu trigger={<Button icon={ClockCounterClockwiseIcon}>Recent</Button>}>
          {(recent.data ?? []).length === 0 ? <MenuGroupLabel>No recent queries</MenuGroupLabel> : null}
          {(recent.data ?? []).map((s) => {
            let parsed: QuerySpec | null = null;
            try {
              parsed = JSON.parse(s) as QuerySpec;
            } catch {
              parsed = null;
            }
            return parsed ? (
              <MenuItem key={s} onClick={() => parsed && setDraft({ ...specToDraft(parsed, root), aggregations: draft.aggregations })}>
                {describeSpec(parsed)}
              </MenuItem>
            ) : null;
          })}
          <MenuSeparator />
          <MenuItem onClick={() => setDraft(newDraft())}>Clear the builder</MenuItem>
        </Menu>
      </div>

      <div className="flex flex-wrap items-start gap-3 border-b border-rule px-6 py-3">
        <Legend className="pt-2">Aggregations</Legend>
        {draft.aggregations.map((a) => (
          <div key={a.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <Select<'count' | 'sum' | 'avg'>
                value={a.op}
                onValueChange={(op) => patch({ aggregations: draft.aggregations.map((x) => (x.id === a.id ? { ...x, op } : x)) })}
                aria-label="Aggregation"
                options={[
                  { value: 'count', label: 'count' },
                  { value: 'sum', label: 'sum' },
                  { value: 'avg', label: 'avg' },
                ]}
                className="w-24"
              />
              {a.op !== 'count' ? (
                <Input
                  mono
                  value={a.field}
                  onChange={(e) =>
                    patch({ aggregations: draft.aggregations.map((x) => (x.id === a.id ? { ...x, field: e.target.value } : x)) })
                  }
                  placeholder="field"
                  aria-label="Aggregated field"
                  className="w-36"
                />
              ) : null}
              <IconButton
                icon={XIcon}
                label="Remove aggregation"
                size="sm"
                onClick={() => patch({ aggregations: draft.aggregations.filter((x) => x.id !== a.id) })}
              />
            </div>
            {errors[a.id] ? <span className="text-meta text-redline-ink">{errors[a.id]}</span> : null}
          </div>
        ))}
        {draft.aggregations.length < 5 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={PlusIcon}
            onClick={() => patch({ aggregations: [...draft.aggregations, { id: newId(), op: 'count', field: '' }] })}
          >
            Aggregation
          </Button>
        ) : null}
        <Button icon={SigmaIcon} onClick={() => void aggregate()} loading={busy && outcome?.kind === 'aggregation'}>
          Run aggregation
        </Button>
      </div>

      <Notes notes={notes} />

      {outcome?.kind === 'problem' ? (
        outcome.problem.suggestedIndex ? (
          <IndexSuggestion
            ctx={ctx}
            index={outcome.problem.suggestedIndex}
            derived={outcome.problem.suggestedIndex.derived}
            onCreated={setPendingIndexOp}
          />
        ) : (
          <ProblemState problem={outcome.problem} onRetry={() => void run()} />
        )
      ) : outcome?.kind === 'aggregation' ? (
        <Section title="Aggregation">
          <table className="mx-6 border-collapse text-dense">
            <tbody>
              {outcome.result.values.map((v, i) => (
                <tr key={outcome.labels[i]} className="border-t border-rule">
                  <td className="py-1 pr-6 font-mono text-[12px] text-ink-2">{outcome.labels[i]}</td>
                  <td className="tnum py-1 pr-6 font-mono text-[13px] text-ink">{previewValue(v)}</td>
                  <td className="py-1 font-mono text-[11px] text-ink-3">{WIRE_TYPE_LABELS[v.t]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {outcome.result.explain ? <ExplainView explain={outcome.result.explain} /> : null}
        </Section>
      ) : outcome?.kind === 'documents' ? (
        <>
          {outcome.explain ? <ExplainView explain={outcome.explain} /> : null}
          {outcome.explain && !outcome.explain.stats ? null : (
            <div className="pt-2">
              <ResultsTable
                rows={outcome.rows}
                root={root}
                fresh={fresh}
                hasMore={!liveOn && !!outcome.nextCursor}
                loadingMore={busy}
                onLoadMore={() => void loadMore()}
                onOpen={(d) => openPath(d.path)}
              />
            </div>
          )}
        </>
      ) : (
        <EmptyState title="Build a query">
          Pick a collection, add conditions, and run it. Values are typed JSON: <Mono value='"text"' />, <Mono value="12" /> (integer),{' '}
          <Mono value="12.0" /> (double), <Mono value='{"$timestamp": "2026-09-28T12:00:00Z"}' />. Use <Mono value="__name__" /> for the
          document id.
        </EmptyState>
      )}

      <Dialog
        open={codeLang !== null}
        onOpenChange={(o) => !o && setCodeLang(null)}
        title="Copy as code"
        width="lg"
        description={codeLanguages.find((l) => l.value === codeLang)?.label}
      >
        {codeLang && spec.ok ? (
          <div className="flex flex-col gap-2">
            <CodeEditor
              value={queryCode(codeLang, ctx.projectId, ctx.databaseId, spec.spec)}
              language={codeLang === 'node' ? 'javascript' : codeLang}
              readOnly
              height={360}
              label="Query code"
            />
            <div className="flex justify-end">
              <Button
                variant="commit"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(queryCode(codeLang, ctx.projectId, ctx.databaseId, spec.spec))
                    .then(() => toast.success('Code copied'));
                  setCodeLang(null);
                }}
              >
                Copy code
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
