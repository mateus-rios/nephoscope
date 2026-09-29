import { type LogEntry, type LogPage, type LogSeverity, type LogTailMessage, logSeverities, type Problem } from '@nephoscope/contracts';
import { ArrowClockwiseIcon, ArrowSquareOutIcon, CaretDownIcon, CaretRightIcon, CopyIcon } from '@phosphor-icons/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { toast } from 'sonner';
import { Button } from '../design/Button';
import { type Note, Notes } from '../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../design/Feedback';
import { Field, Input, Select, Switch } from '../design/Form';
import { JsonTree } from '../design/JsonTree';
import { useScrollParent } from '../design/ScrollParent';
import { ApiError, api, qs } from '../lib/api';
import { cn } from '../lib/cn';
import { live } from '../lib/live';
import { useSession } from '../state/session';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from './timeRange';
import { useSearchState } from './urlState';

type Row = { kind: 'entry'; entry: LogEntry } | { kind: 'gap'; id: string; text: string };

const TAIL_LIMIT = 2000;

const SEVERITY_MARK: Record<LogSeverity, { letter: string; className: string; label: string }> = {
  DEFAULT: { letter: '·', className: 'text-ink-3', label: 'Default' },
  DEBUG: { letter: 'D', className: 'text-ink-3', label: 'Debug' },
  INFO: { letter: 'I', className: 'text-ink-2', label: 'Info' },
  NOTICE: { letter: 'N', className: 'text-ink-2', label: 'Notice' },
  WARNING: { letter: 'W', className: 'text-warn-ink', label: 'Warning' },
  ERROR: { letter: 'E', className: 'text-redline-ink', label: 'Error' },
  CRITICAL: { letter: 'C', className: 'font-bold text-redline-ink', label: 'Critical' },
  ALERT: { letter: 'A', className: 'font-bold text-redline-ink', label: 'Alert' },
  EMERGENCY: { letter: '!', className: 'font-bold text-redline-ink', label: 'Emergency' },
};

/** A JSON pointer into an entry to an LQL field path; null for paths LQL cannot address. */
export function pointerToLql(pointer: string): string | null {
  const segments = pointer
    .split('/')
    .slice(1)
    .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (segments.length === 0 || segments.some((s) => /^\d+$/.test(s))) return null;
  return segments.map((s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)).join('.');
}

export function lqlValue(value: unknown): string | null {
  if (typeof value === 'string') return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function joinFilter(base: string, extra: string, severity: LogSeverity): string {
  const parts = [`(${base})`];
  if (extra.trim()) parts.push(`(${extra.trim()})`);
  if (severity !== 'DEFAULT') parts.push(`severity>=${severity}`);
  return parts.join(' AND ');
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
});
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? timeFormat.format(d) : `${dateFormat.format(d)} ${timeFormat.format(d)}`;
}

const EntryRow = memo(function EntryRow({
  entry,
  expanded,
  onToggle,
  onShowMatching,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  onShowMatching: (pointer: string, value: unknown) => void;
}) {
  const mark = SEVERITY_MARK[entry.severity];
  return (
    <div className="border-b border-rule">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[1rem_8.5rem_1rem_1fr] items-center gap-x-2 px-6 py-1 text-left text-dense hover:bg-hover"
      >
        {expanded ? (
          <CaretDownIcon size={12} className="text-ink-3" aria-hidden />
        ) : (
          <CaretRightIcon size={12} className="text-ink-3" aria-hidden />
        )}
        <span className="tnum truncate font-mono text-[11px] text-ink-2">{formatTime(entry.timestamp)}</span>
        <span className={cn('text-center font-mono text-[11px]', mark.className)} title={mark.label}>
          <span aria-hidden>{mark.letter}</span>
          <span className="sr-only">{mark.label}</span>
        </span>
        <span className="truncate font-mono text-[12px] text-ink">{entry.summary || entry.logName.split('/').pop()}</span>
      </button>
      {expanded ? (
        <div className="px-6 pt-1 pb-3 pl-12">
          <JsonTree value={entry.raw} label="Log entry" expandDepth={2} height={420} searchable={false} onShowMatching={onShowMatching} />
        </div>
      ) : null}
    </div>
  );
});

interface LogsPanelProps {
  projectId: string;
  /** The resource's base filter (SPEC-0003 CA-30). */
  filter: string;
}

/** The shared Logs panel (SPEC-0005 D-01 to D-03, CA-01 to CA-04). */
export function LogsPanel({ projectId, filter }: LogsPanelProps) {
  const profileId = useSession((s) => s.profileId);
  const scrollParent = useScrollParent();
  const [range, setRange] = useSearchState<TimeRange>('range', '1h', timeRanges);
  const [severity, setSeverity] = useSearchState<LogSeverity>('sev', 'DEFAULT', logSeverities);
  const [extra, setExtra] = useSearchState<string>('lq', '');
  const [draft, setDraft] = useState(extra);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tailing, setTailing] = useState(false);
  const [tailRows, setTailRows] = useState<Row[]>([]);
  const [tailProblem, setTailProblem] = useState<Problem | null>(null);
  const [waitLeft, setWaitLeft] = useState<number | null>(null);

  useEffect(() => setDraft(extra), [extra]);
  // A new filter or range is a new query from now; tailed entries belong to the old one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the query changes.
  useEffect(() => {
    setAnchor(Date.now());
    setTailRows([]);
  }, [filter, extra, severity, range]);

  const since = rangeStart(range, anchor);
  const query = useInfiniteQuery({
    queryKey: ['logs', profileId, projectId, filter, extra, severity, range, anchor],
    queryFn: ({ pageParam, signal }) =>
      api<LogPage>(
        `/api/projects/${encodeURIComponent(projectId)}/logs${qs({
          filter,
          extra: extra || undefined,
          minSeverity: severity === 'DEFAULT' ? undefined : severity,
          since,
          until: new Date(anchor).toISOString(),
          pageSize: 100,
          pageToken: pageParam,
        })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
    retry: false,
    // Log lists never refresh by themselves (SPEC-0005 D-02).
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
  });

  // Quota waits: count down, then retry the same request (SPEC-0005 D-02).
  const problem = query.error instanceof ApiError ? query.error.problem : null;
  const waitSeconds = problem?.retryAfterSeconds ?? null;
  const { refetch, fetchNextPage, hasNextPage } = query;
  useEffect(() => {
    if (waitSeconds === null) {
      setWaitLeft(null);
      return;
    }
    const until = Date.now() + waitSeconds * 1000;
    setWaitLeft(waitSeconds);
    const tick = setInterval(() => setWaitLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 1000);
    const retry = setTimeout(() => {
      if (hasNextPage && (query.data?.pages.length ?? 0) > 0) void fetchNextPage();
      else void refetch();
    }, waitSeconds * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(retry);
    };
  }, [waitSeconds, refetch, fetchNextPage, hasNextPage, query.data?.pages.length]);

  // Live tail (SPEC-0005 D-03).
  const tailFilter = joinFilter(filter, extra, severity);
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    if (!tailing || !profileId) return;
    setTailProblem(null);
    let counter = 0;
    const push = (rows: Row[]) =>
      setTailRows((prev) => {
        const next = [...rows, ...prev];
        if (next.length <= TAIL_LIMIT) return next;
        const dropped = next.length - TAIL_LIMIT;
        return [
          ...next.slice(0, TAIL_LIMIT - 1),
          { kind: 'gap', id: `drop-${Date.now()}`, text: `${dropped} older live entries were dropped from view` },
        ];
      });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current) {
        const seconds = Math.round((Date.now() - hiddenAt.current) / 1000);
        hiddenAt.current = null;
        push([{ kind: 'gap', id: `pause-${++counter}`, text: `Live tail paused for ${seconds} s while the tab was hidden` }]);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = live.subscribe(
      'logging.tail',
      { profileId, projectId },
      { filter: tailFilter },
      {
        data(payload) {
          const msg = payload as LogTailMessage;
          if (msg.kind === 'entries') push(msg.entries.map((entry) => ({ kind: 'entry', entry }) as Row).reverse());
          else if (msg.kind === 'suppressed') {
            const why =
              msg.reason === 'rate_limit'
                ? 'rate limits'
                : msg.reason === 'not_consumed'
                  ? 'the stream not keeping up'
                  : 'an unknown reason';
            push([{ kind: 'gap', id: `sup-${++counter}`, text: `Google skipped ${msg.count} entries because of ${why}` }]);
          }
        },
        gap(dropped) {
          push([{ kind: 'gap', id: `gap-${++counter}`, text: `${dropped} entries were dropped because the browser fell behind` }]);
        },
        error(p) {
          setTailProblem(p);
          setTailing(false);
        },
        end() {
          setTailing(false);
        },
      },
    );
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tailing, profileId, projectId, tailFilter]);

  const rows = useMemo<Row[]>(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of tailRows) {
      if (r.kind === 'entry') {
        if (seen.has(r.entry.id)) continue;
        seen.add(r.entry.id);
      }
      out.push(r);
    }
    for (const page of query.data?.pages ?? []) {
      for (const entry of page.entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push({ kind: 'entry', entry });
      }
    }
    return out;
  }, [tailRows, query.data]);

  const showMatching = (pointer: string, value: unknown) => {
    const field = pointerToLql(pointer);
    const v = lqlValue(value);
    if (!field || v === null) {
      toast('This value cannot be matched in a filter');
      return;
    }
    const clause = `${field}=${v}`;
    setExtra(extra.trim() ? `${extra.trim()} AND ${clause}` : clause);
  };

  const notes: Note[] = [];
  if (waitLeft !== null) notes.push({ id: 'quota', tone: 'info', text: `Waiting for Logging quota, about ${waitLeft} s.` });
  if (tailProblem) {
    notes.push({
      id: 'tail',
      tone: 'error',
      text: tailProblem.detail,
      action: (
        <Button size="sm" variant="ghost" onClick={() => setTailing(true)}>
          Try again
        </Button>
      ),
    });
  }
  if (tailing) notes.push({ id: 'tailing', tone: 'ok', text: 'Live tail is on. New entries appear at the top as they arrive.' });

  const fullFilter = `${tailFilter} AND timestamp>="${since}"`;
  const consoleUrl = `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(tailFilter)}?project=${encodeURIComponent(projectId)}`;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 px-6 py-3">
        <Field label="Range" className="w-44">
          <Select<TimeRange>
            value={range}
            onValueChange={setRange}
            options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
          />
        </Field>
        <Field label="Minimum severity" className="w-40">
          <Select<LogSeverity>
            value={severity}
            onValueChange={setSeverity}
            options={logSeverities.map((s) => ({ value: s, label: s === 'DEFAULT' ? 'Any' : SEVERITY_MARK[s].label }))}
          />
        </Field>
        <form
          className="flex min-w-72 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setExtra(draft.trim());
          }}
        >
          <Field label="Extra filter (LQL)" className="flex-1">
            <Input data-filter-input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='textPayload:"timeout"' />
          </Field>
          <Button type="submit" disabled={draft.trim() === extra.trim()}>
            Apply
          </Button>
        </form>
        <div className="flex items-center gap-2 pb-1">
          <Switch checked={tailing} onCheckedChange={setTailing} label="Live tail" />
        </div>
        <Button icon={ArrowClockwiseIcon} onClick={() => setAnchor(Date.now())} disabled={query.isFetching}>
          Refresh
        </Button>
      </div>
      <Notes notes={notes} title="Status" />
      {query.isPending && !problem ? (
        <DelayedSkeleton rows={8} />
      ) : problem && waitSeconds === null && rows.length === 0 ? (
        <ProblemState problem={problem} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No log entries">
          No entries match this filter in the range. Widen the range, lower the severity, or turn on the live tail.
        </EmptyState>
      ) : (
        <div className="border-t border-rule">
          <Virtuoso
            customScrollParent={scrollParent ?? undefined}
            useWindowScroll={!scrollParent}
            data={rows}
            computeItemKey={(_i, r) => (r.kind === 'entry' ? r.entry.id : r.id)}
            itemContent={(_i, r) =>
              r.kind === 'gap' ? (
                <div className="border-b border-rule bg-well px-6 py-1 text-meta text-ink-2">{r.text}</div>
              ) : (
                <EntryRow
                  entry={r.entry}
                  expanded={expanded.has(r.entry.id)}
                  onToggle={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.entry.id)) next.delete(r.entry.id);
                      else next.add(r.entry.id);
                      return next;
                    })
                  }
                  onShowMatching={showMatching}
                />
              )
            }
          />
          <div className="flex flex-wrap items-center gap-2 px-6 py-3">
            {query.hasNextPage ? (
              <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Load older
              </Button>
            ) : (
              <span className="text-meta text-ink-3">No older entries in this range.</span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={CopyIcon}
                onClick={() => {
                  void navigator.clipboard.writeText(fullFilter);
                  toast('Filter copied');
                }}
              >
                Copy filter
              </Button>
              <a href={consoleUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-meta">
                Open in Google Cloud console
                <ArrowSquareOutIcon size={12} aria-hidden />
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
