import {
  expandRawPath,
  queryStringOf,
  type RawApiEntry,
  type RawApiTree,
  type RawCallResult,
  type RawHistoryItem,
  type RawMethodDetail,
  type RawMethodSummary,
  type RawResourceNode,
  rawConfirmToken,
  rawCurl,
} from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon, PaperPlaneRightIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend, Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { JsonTree } from '../../design/JsonTree';
import { Menu, MenuGroupLabel, MenuItem } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { CopyButton } from '../../design/Values';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/rawapi`;

function useRaw<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['rawapi', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
    // Discovery documents change rarely; once per session is enough (SPEC-0009 R-02).
    staleTime: 60 * 60_000,
  });
}

function MethodList({ methods, selected, onSelect }: { methods: RawMethodSummary[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <>
      {methods.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => onSelect(m.id)}
            aria-current={selected === m.id ? 'true' : undefined}
            className={
              selected === m.id
                ? 'flex min-h-6 w-full items-center gap-2 rounded-control bg-well px-1.5 text-left'
                : 'flex min-h-6 w-full items-center gap-2 rounded-control px-1.5 text-left hover:bg-well'
            }
            title={m.description}
          >
            <span className="w-12 shrink-0 font-mono text-[10px] text-ink-2">{m.httpMethod}</span>
            <span className="truncate font-mono text-[12px] text-ink">{m.id.split('.').pop()}</span>
          </button>
        </li>
      ))}
    </>
  );
}

function ResourceTree({
  node,
  depth,
  filter,
  selected,
  onSelect,
}: {
  node: RawResourceNode;
  depth: number;
  filter: string;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0 || !!filter);
  useEffect(() => {
    if (filter) setOpen(true);
  }, [filter]);
  const methods = node.methods.filter((m) => !filter || m.id.toLowerCase().includes(filter));
  const children = node.resources;
  return (
    <li>
      <span className="flex min-h-6 items-center gap-1">
        <IconButton
          icon={open ? CaretDownIcon : CaretRightIcon}
          label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
        <span className="truncate font-mono text-[12px] text-ink-2">{node.name}</span>
      </span>
      {open ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 pl-5">
          <MethodList methods={methods} selected={selected} onSelect={onSelect} />
          {children.map((c) => (
            <ResourceTree key={c.name} node={c} depth={depth + 1} filter={filter} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ApiPicker({ entries, value, onChange }: { entries: RawApiEntry[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return entries
      .filter((e) => (t ? e.id.includes(t) || e.title.toLowerCase().includes(t) : e.preferred))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.title.localeCompare(b.title))
      .slice(0, 50);
  }, [entries, q]);
  return (
    <div className="flex flex-col gap-2">
      <Field label="API" help={`${entries.length} APIs in the discovery directory.`}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, such as run or compute" />
      </Field>
      <ul className="m-0 flex max-h-56 list-none flex-col gap-0.5 overflow-auto p-0" aria-label="APIs">
        {shown.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onChange(e.id)}
              aria-current={value === e.id ? 'true' : undefined}
              className={
                value === e.id
                  ? 'flex min-h-6 w-full flex-col rounded-control bg-well px-1.5 py-0.5 text-left'
                  : 'flex min-h-6 w-full flex-col rounded-control px-1.5 py-0.5 text-left hover:bg-well'
              }
            >
              <span className="truncate text-dense text-ink">{e.title}</span>
              <span className="font-mono text-[10px] text-ink-3">{e.id}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ParamInputProps {
  p: RawMethodDetail['parameters'][number];
  value: string;
  onChange: (v: string) => void;
  /** Set by Field, which labels the control (SPEC-0002 CA-11). */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

function ParamInput({ p, value, onChange, ...field }: ParamInputProps) {
  if (p.enum.length > 0 || p.type === 'boolean') {
    const values = p.enum.length > 0 ? p.enum : ['true', 'false'];
    return (
      <Select<string>
        {...field}
        value={value}
        onValueChange={onChange}
        options={[{ value: '', label: '(not set)' }, ...values.map((v) => ({ value: v, label: v }))]}
      />
    );
  }
  return (
    <Input
      {...field}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      mono
      placeholder={p.pattern ? `matches ${p.pattern}` : undefined}
    />
  );
}

function MethodForm({
  projectId,
  api: apiId,
  method,
  readOnly,
  seed,
}: {
  projectId: string;
  api: string;
  method: RawMethodDetail;
  readOnly: string | null;
  seed: RawHistoryItem | null;
}) {
  const [name, version] = apiId.split(':') as [string, string];
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState('{}');
  const [result, setResult] = useState<RawCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  useEffect(() => {
    const fromSeed = seed && seed.methodId === method.id ? seed : null;
    const v: Record<string, string> = {};
    for (const p of method.parameters) {
      const s = fromSeed?.params[p.name];
      v[p.name] = Array.isArray(s) ? s.join(',') : (s ?? (p.name === 'project' || p.name === 'projectId' ? projectId : ''));
    }
    setValues(v);
    setBody(fromSeed?.body !== undefined ? JSON.stringify(fromSeed.body, null, 2) : '{}');
    setResult(null);
    setError(null);
  }, [method, seed, projectId]);

  const params = useMemo(() => {
    const out: Record<string, string | string[]> = {};
    for (const p of method.parameters) {
      const v = values[p.name]?.trim();
      if (!v) continue;
      out[p.name] = p.repeated
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : v;
    }
    return out;
  }, [method, values]);
  let path = '';
  let pathError: string | null = null;
  try {
    path = expandRawPath(method.path, params);
  } catch (err) {
    pathError = (err as Error).message;
  }
  let parsedBody: unknown;
  let bodyError: string | null = null;
  if (method.requestRef) {
    try {
      parsedBody = JSON.parse(body);
    } catch (err) {
      bodyError = `The body is not valid JSON: ${(err as Error).message}`;
    }
  }
  const missing = method.parameters.filter((p) => p.required && !values[p.name]?.trim()).map((p) => p.name);
  const url = pathError
    ? ''
    : `${method.baseUrl}${path}${queryStringOf(Object.fromEntries(Object.entries(params).filter(([k]) => method.parameters.find((p) => p.name === k)?.location === 'query')))}`;
  const write = method.httpMethod !== 'GET';
  const blocked = (write ? readOnly : null) ?? (missing.length ? `Fill in ${missing.join(', ')}` : null) ?? pathError ?? bodyError;

  async function send(confirm?: string) {
    setSending(true);
    setError(null);
    try {
      const b = { api: name, version, methodId: method.id, params, body: method.requestRef ? parsedBody : undefined, confirm };
      const r = await api<RawCallResult>(write ? `${base(projectId)}/write/${enc(method.id)}` : `${base(projectId)}/read`, { body: b });
      setResult(r);
      void client.invalidateQueries({ queryKey: ['rawapi', profileId, projectId, 'history'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : String(err));
      throw err;
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12px] font-semibold text-ink">{method.httpMethod}</span>
          <span className="font-mono text-[12px] break-all text-ink">{method.id}</span>
        </span>
        <span className="font-mono text-[11px] break-all text-ink-3">{method.path}</span>
        {method.description ? <p className="m-0 max-w-3xl text-dense whitespace-pre-line text-ink-2">{method.description}</p> : null}
      </div>
      {method.parameters.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {method.parameters.map((p) => (
            <Field
              key={p.name}
              label={`${p.name}${p.location === 'path' ? ' (path)' : ''}${p.repeated ? ' (list)' : ''}`}
              required={p.required}
              help={p.description.split(/(?<=\.)\s/)[0]}
            >
              <ParamInput p={p} value={values[p.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} />
            </Field>
          ))}
        </div>
      ) : null}
      {method.requestRef ? (
        <Field
          label={`Request body (${method.requestRef})`}
          help="Checked against the method's schema as you type."
          error={bodyError ?? undefined}
        >
          <CodeEditor
            value={body}
            onChange={setBody}
            language="json"
            height={240}
            label="Request body"
            path={`rawapi-${method.id}.json`}
            jsonSchema={method.requestSchema ? { uri: `nephoscope://rawapi/${method.id}.json`, schema: method.requestSchema } : undefined}
          />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={write ? (method.httpMethod === 'DELETE' ? 'danger' : 'commit') : 'commit'}
          icon={PaperPlaneRightIcon}
          loading={sending}
          disabled={!!blocked}
          disabledReason={blocked}
          onClick={() => (method.httpMethod === 'DELETE' ? setConfirming(true) : void send().catch(() => undefined))}
        >
          Send {method.httpMethod}
        </Button>
        <span className="text-meta text-ink-2">
          {write ? 'Changes Google Cloud with the active profile; recorded in the audit log.' : 'Reads with the active profile.'}
        </span>
      </div>
      {url ? (
        <section aria-label="Copy as curl" className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Legend>Copy as curl</Legend>
            <span className="ml-auto">
              <CopyButton value={rawCurl(method.httpMethod, url, method.requestRef ? parsedBody : undefined)} label="Copy curl" />
            </span>
          </div>
          <pre className="m-0 max-h-48 overflow-auto rounded-control bg-well p-3 font-mono text-[11px] leading-5 whitespace-pre text-ink">
            {rawCurl(method.httpMethod, url, method.requestRef ? parsedBody : undefined)}
          </pre>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-dense text-redline-ink">
          {error}
        </p>
      ) : null}
      {result ? (
        <Section title="Response">
          <div className="flex flex-col gap-3">
            <span className="flex flex-wrap items-center gap-3">
              <StatusGlyph
                kind={result.status < 300 ? 'ok' : result.status < 400 ? 'warn' : 'error'}
                label={`${result.status} ${result.statusText}`}
              />
              <span className="text-meta text-ink-2">{result.durationMs} ms</span>
            </span>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[11px]">
              {Object.entries(result.headers).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="m-0 break-all text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {/* The response is project data: rendered as text (SPEC-0001 D-22). */}
            {typeof result.body === 'string' ? (
              <pre className="m-0 max-h-96 overflow-auto rounded-control bg-well p-3 font-mono text-[12px] whitespace-pre-wrap text-ink">
                {result.body}
              </pre>
            ) : (
              <JsonTree value={result.body} label="Response body" height={420} />
            )}
          </div>
        </Section>
      ) : null}
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title={`Send DELETE ${method.id.split('.').pop()}`}
        consequence={`Deletes ${path}. Most deletions cannot be undone.`}
        expected={rawConfirmToken(path)}
        confirmLabel="Send DELETE"
        command={url ? rawCurl('DELETE', url, undefined) : undefined}
        onConfirm={(confirm) => send(confirm)}
      />
    </div>
  );
}

/** Any Google Cloud API method, from its discovery document (SPEC-0009 D-01). */
export function RawApiPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [apiId, setApiId] = useSearchState<string>('api', 'serviceusage:v1');
  const [methodId, setMethodId] = useSearchState<string>('method', '');
  const [filter, setFilter] = useState('');
  const [seed, setSeed] = useState<RawHistoryItem | null>(null);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const [name, version] = apiId.includes(':') ? (apiId.split(':') as [string, string]) : ['', ''];
  const directory = useRaw<RawApiEntry[]>(projectId, ['apis'], `${base(projectId)}/apis`);
  const tree = useRaw<RawApiTree>(projectId, ['tree', apiId], `${base(projectId)}/apis/${enc(name)}/${enc(version)}`, !!name);
  const method = useRaw<RawMethodDetail>(
    projectId,
    ['method', apiId, methodId],
    `${base(projectId)}/apis/${enc(name)}/${enc(version)}/methods/${enc(methodId)}`,
    !!name && !!methodId,
  );
  const history = useRaw<RawHistoryItem[]>(projectId, ['history'], `${base(projectId)}/history`);
  useEffect(() => {
    document.title = 'API console · Nephoscope';
  }, []);
  const f = filter.trim().toLowerCase();
  return (
    <div className="pb-16">
      <TitleBlock
        title="API console"
        subtitle="Call any Google Cloud API method with the active profile. Writes follow the same read-only, confirmation and audit rules as the rest of Nephoscope."
        actions={
          <Menu trigger={<Button>History</Button>} align="end">
            {(history.data ?? []).length === 0 ? <MenuGroupLabel>No requests yet</MenuGroupLabel> : null}
            {(history.data ?? []).map((h) => (
              <MenuItem
                key={`${h.at}-${h.methodId}`}
                onClick={() => {
                  setApiId(`${h.api}:${h.version}`);
                  setMethodId(h.methodId);
                  setSeed(h);
                }}
              >
                <span className="flex max-w-[28rem] items-baseline gap-2 truncate">
                  <span className="font-mono text-[10px] text-ink-2">{h.httpMethod}</span>
                  <span className="truncate font-mono text-[11px]">{h.methodId}</span>
                  <span className="text-[10px] text-ink-3">{h.status}</span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        }
      />
      <div className="grid border-t border-rule md:grid-cols-[20rem_1fr]">
        <aside aria-label="APIs and methods" className="flex flex-col gap-4 border-b border-rule px-4 py-3 md:border-r md:border-b-0">
          {directory.isPending ? (
            <DelayedSkeleton rows={4} />
          ) : directory.error instanceof ApiError ? (
            <ProblemState problem={directory.error.problem} onRetry={() => void directory.refetch()} />
          ) : (
            <ApiPicker
              entries={directory.data ?? []}
              value={apiId}
              onChange={(id) => {
                setApiId(id);
                setMethodId('');
              }}
            />
          )}
          {tree.data ? (
            <div className="flex flex-col gap-2">
              <Field label={`Methods of ${tree.data.title}`}>
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter, such as services.list" />
              </Field>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={`Methods of ${tree.data.title}`}>
                <MethodList
                  methods={tree.data.methods.filter((m) => !f || m.id.toLowerCase().includes(f))}
                  selected={methodId}
                  onSelect={setMethodId}
                />
                {tree.data.resources.map((r) => (
                  <ResourceTree key={r.name} node={r} depth={0} filter={f} selected={methodId} onSelect={setMethodId} />
                ))}
              </ul>
            </div>
          ) : tree.isPending && name ? (
            <DelayedSkeleton rows={6} />
          ) : tree.error instanceof ApiError ? (
            <ProblemState problem={tree.error.problem} onRetry={() => void tree.refetch()} />
          ) : null}
        </aside>
        <div className="min-w-0 px-6 py-4">
          {!methodId ? (
            <EmptyState title="Choose a method">
              Pick an API, then a method from its resources. Its parameters and request body become a form.
            </EmptyState>
          ) : method.isPending ? (
            <DelayedSkeleton rows={6} />
          ) : method.error instanceof ApiError ? (
            <ProblemState problem={method.error.problem} onRetry={() => void method.refetch()} />
          ) : method.data ? (
            <MethodForm projectId={projectId} api={apiId} method={method.data} readOnly={readOnly} seed={seed} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
