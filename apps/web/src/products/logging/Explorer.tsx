import { type LogEntry, type LogSeverity, logSeverities } from '@nephoscope/contracts';
import { BookmarkSimpleIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, PlayIcon, TrashIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { queryHints } from '../../design/code/hints';
import { Legend } from '../../design/Drafting';
import { Field, Input } from '../../design/Form';
import { Dialog, Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../design/Overlays';
import { LogsPanel } from '../../kit/LogsPanel';
import { rangeMs, rangeStart, type TimeRange, timeRanges } from '../../kit/timeRange';
import { useSearchState } from '../../kit/urlState';
import { api, downloadFromApi, qs } from '../../lib/api';
import { useTokenColors } from '../../lib/color';
import { useDeleteSaved, useLogsCatalog, useSaved, useSaveItem } from './api';

const COLORS = ['redline', 'warn', 'ink-3', 'rule', 'ink-2', 'panel', 'ink'] as const;

type Band = 'error' | 'warning' | 'other';
const bandOf = (s: LogSeverity): Band =>
  logSeverities.indexOf(s) >= logSeverities.indexOf('ERROR') ? 'error' : s === 'WARNING' ? 'warning' : 'other';

const tickTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** Entries per time bucket and severity band, over the loaded entries only (SPEC-0005 D-04). */
export function histogram(entries: LogEntry[], fromMs: number, toMs: number, buckets = 40) {
  const width = Math.max(1000, Math.ceil((toMs - fromMs) / buckets));
  const rows = Array.from({ length: buckets }, (_, i) => ({ t: fromMs + i * width, error: 0, warning: 0, other: 0 }));
  for (const e of entries) {
    const t = e.timestamp ? Date.parse(e.timestamp) : Number.NaN;
    if (!Number.isFinite(t) || t < fromMs) continue;
    const row = rows[Math.min(buckets - 1, Math.floor((t - fromMs) / width))];
    if (row) row[bandOf(e.severity)]++;
  }
  return rows;
}

function facet(entries: LogEntry[], key: (e: LogEntry) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const k = key(e);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

const logId = (name: string) => {
  const raw = name.replace(/^projects\/[^/]+\/logs\//, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const quote = (v: string) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

function Facets({ title, rows, onPick }: { title: string; rows: [string, number][]; onPick: (value: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <Legend>{title}</Legend>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map(([value, n]) => (
          <li key={value}>
            <button
              type="button"
              onClick={() => onPick(value)}
              title={`Add ${value} to the query`}
              className="grid min-h-6 w-full grid-cols-[1fr_auto] items-center gap-2 rounded-control px-1.5 py-0.5 text-left text-meta hover:bg-hover"
            >
              <span className="truncate font-mono text-[11px] text-ink">{value}</span>
              <span className="tnum text-ink-3">{n}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Logs Explorer (SPEC-0005 D-04, CA-05). */
export function Explorer({ projectId }: { projectId: string }) {
  const [query, setQuery] = useSearchState<string>('q', '');
  const [range] = useSearchState<TimeRange>('range', '1h', timeRanges);
  const [draft, setDraft] = useState(query);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [managing, setManaging] = useState(false);
  const catalog = useLogsCatalog(projectId);
  const saved = useSaved('logs', projectId);
  const save = useSaveItem('logs', projectId);
  const removeSaved = useDeleteSaved('logs');
  const client = useQueryClient();
  const historyKey = `logs.recent:${projectId}`;
  const recent = useQuery({
    queryKey: ['history', historyKey],
    queryFn: ({ signal }) => api<string[]>(`/api/history/${encodeURIComponent(historyKey)}`, { signal, profileId: null }),
  });
  const colors = useTokenColors(COLORS);

  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    queryHints.lql.project = projectId;
    if (catalog.data) {
      queryHints.lql.logNames = catalog.data.logNames;
      queryHints.lql.resourceTypes = catalog.data.resourceTypes;
    }
  }, [catalog.data, projectId]);

  const run = useCallback(
    (text: string) => {
      const q = text.trim();
      setQuery(q);
      if (q) {
        void api(`/api/history/${encodeURIComponent(historyKey)}`, { body: { value: q }, profileId: null }).then(() =>
          client.invalidateQueries({ queryKey: ['history', historyKey] }),
        );
      }
    },
    [setQuery, historyKey, client],
  );
  const append = useCallback(
    (clause: string) => {
      const next = query.trim() ? `${query.trim()}\n${clause}` : clause;
      setDraft(next);
      run(next);
    },
    [query, run],
  );
  const explorer = useMemo(() => ({ onShowMatching: append, onEntries: setEntries }), [append]);

  const now = Date.now();
  const fromMs = now - rangeMs(range);
  const bars = useMemo(() => histogram(entries, fromMs, now), [entries, fromMs, now]);
  const resourceFacet = useMemo(() => facet(entries, (e) => e.resource.type), [entries]);
  const logFacet = useMemo(() => facet(entries, (e) => logId(e.logName)), [entries]);
  const severityFacet = useMemo(() => facet(entries, (e) => e.severity), [entries]);

  const download = (format: 'json' | 'csv') => {
    const url = `/api/projects/${encodeURIComponent(projectId)}/logging/download${qs({ filter: query, since: rangeStart(range, Date.now()), format })}`;
    toast('Download started', { description: 'Up to 10,000 entries, read within the Logging quota.' });
    void downloadFromApi(url, `logs-${projectId}.${format}`).catch((err: Error) =>
      toast.error('Download failed', { description: err.message }),
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 px-6 pt-4">
        <CodeEditor value={draft} onChange={setDraft} language="lql" height={112} label="Logs query" onRun={() => run(draft)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="commit" icon={PlayIcon} onClick={() => run(draft)} disabled={draft.trim() === query.trim()}>
            Run query
          </Button>
          <span className="text-meta text-ink-3">Ctrl+Enter runs the query. An empty query shows every entry.</span>
          <span className="ml-auto flex items-center gap-1">
            <Menu trigger={<Button icon={ClockCounterClockwiseIcon}>Recent</Button>} align="end">
              {(recent.data ?? []).length === 0 ? <MenuGroupLabel>No recent queries</MenuGroupLabel> : null}
              {(recent.data ?? []).map((q) => (
                <MenuItem key={q} onClick={() => run(q)}>
                  <span className="max-w-[28rem] truncate font-mono text-[11px]">{q}</span>
                </MenuItem>
              ))}
            </Menu>
            <Menu trigger={<Button icon={BookmarkSimpleIcon}>Saved</Button>} align="end">
              <MenuItem onClick={() => setSaving(true)} disabled={!draft.trim()}>
                Save this query
              </MenuItem>
              <MenuSeparator />
              {(saved.data ?? []).length === 0 ? <MenuGroupLabel>No saved queries</MenuGroupLabel> : null}
              {(saved.data ?? []).map((s) => (
                <MenuItem key={s.id} onClick={() => run(s.value)}>
                  <span className="max-w-[28rem] truncate">{s.name}</span>
                </MenuItem>
              ))}
              {(saved.data ?? []).length > 0 ? (
                <>
                  <MenuSeparator />
                  <MenuItem onClick={() => setManaging(true)}>Manage saved queries</MenuItem>
                </>
              ) : null}
            </Menu>
            <Menu trigger={<Button icon={DownloadSimpleIcon}>Download</Button>} align="end">
              <MenuItem onClick={() => download('json')}>Download as JSON</MenuItem>
              <MenuItem onClick={() => download('csv')}>Download as CSV</MenuItem>
            </Menu>
          </span>
        </div>
      </div>
      <div className="mt-3 grid border-t border-rule md:grid-cols-[15rem_1fr]">
        <aside aria-label="Facets" className="flex flex-col gap-4 border-b border-rule px-6 py-3 md:border-r md:border-b-0 md:px-4">
          <Facets title="Resource type" rows={resourceFacet} onPick={(v) => append(`resource.type=${quote(v)}`)} />
          <Facets
            title="Log name"
            rows={logFacet}
            onPick={(v) => append(`logName="projects/${projectId}/logs/${encodeURIComponent(v)}"`)}
          />
          <Facets title="Severity" rows={severityFacet} onPick={(v) => append(`severity=${v}`)} />
          {entries.length === 0 ? <p className="m-0 text-meta text-ink-3">Facets count the entries loaded below.</p> : null}
        </aside>
        <div className="min-w-0">
          <figure className="m-0 border-b border-rule px-6 py-3">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <Legend>Entries over time</Legend>
              <span className="flex flex-wrap items-center gap-3 text-meta text-ink-2">
                {(['error', 'warning', 'other'] as const).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block size-2 rounded-[2px]"
                      style={{ backgroundColor: colors[b === 'error' ? 'redline' : b === 'warning' ? 'warn' : 'ink-3'] }}
                      aria-hidden
                    />
                    {b === 'error' ? 'Error and above' : b === 'warning' ? 'Warning' : 'Other'}
                  </span>
                ))}
                <span className="text-ink-3">Based on the {entries.length} entries loaded</span>
              </span>
            </figcaption>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                  <CartesianGrid stroke={colors.rule} vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t: number) => tickTime.format(t)}
                    stroke={colors['ink-3']}
                    tick={{ fontSize: 11, fill: colors['ink-2'] }}
                    minTickGap={40}
                  />
                  <YAxis width={36} allowDecimals={false} stroke={colors['ink-3']} tick={{ fontSize: 11, fill: colors['ink-2'] }} />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: colors.rule }}
                    contentStyle={{ background: colors.panel, border: `1px solid ${colors.rule}`, fontSize: 12, color: colors.ink }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                    formatter={(v, name) => [String(v), name === 'error' ? 'Error and above' : name === 'warning' ? 'Warning' : 'Other']}
                  />
                  <Bar dataKey="other" stackId="s" fill={colors['ink-3']} isAnimationActive={false} />
                  <Bar dataKey="warning" stackId="s" fill={colors.warn} isAnimationActive={false} />
                  <Bar dataKey="error" stackId="s" fill={colors.redline} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </figure>
          <LogsPanel projectId={projectId} filter={query} explorer={explorer} />
        </div>
      </div>
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save query"
        width="sm"
        footer={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button
              variant="commit"
              disabled={!saveName.trim()}
              loading={save.isPending}
              onClick={() => save.mutate({ name: saveName.trim(), value: draft.trim() }, { onSuccess: () => setSaving(false) })}
            >
              Save query
            </Button>
          </>
        }
      >
        <Field label="Name" help="Saved queries stay in this Nephoscope, per project.">
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus />
        </Field>
      </Dialog>
      <Dialog
        open={managing}
        onOpenChange={setManaging}
        title="Saved queries"
        footer={<Button onClick={() => setManaging(false)}>Close</Button>}
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {(saved.data ?? []).map((s) => (
            <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-rule py-1">
              <span className="min-w-0">
                <span className="block truncate text-dense text-ink">{s.name}</span>
                <span className="block truncate font-mono text-[11px] text-ink-3">{s.value}</span>
              </span>
              <IconButton icon={TrashIcon} label={`Remove ${s.name}`} size="sm" onClick={() => removeSaved.mutate(s.id)} />
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
