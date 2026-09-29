import type { OperationSummary } from '@nephoscope/contracts';
import { StackIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Legend } from '../design/Drafting';
import { Popover } from '../design/Overlays';
import { StatusGlyph, type StatusKind } from '../design/Status';
import { Timestamp } from '../design/Values';
import { live } from '../lib/live';
import { sortOperations, useOperations } from '../state/operations';
import { useSession } from '../state/session';

const statusKind: Record<OperationSummary['status'], StatusKind> = {
  running: 'running',
  succeeded: 'ok',
  failed: 'error',
  cancelled: 'paused',
  unknown: 'unknown',
};

const statusLabel: Record<OperationSummary['status'], string> = {
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};

/** Queries affected when an operation finishes (SPEC-0001 CA-33). */
function invalidateFor(client: ReturnType<typeof useQueryClient>, op: OperationSummary) {
  if (op.product === 'apis') {
    void client.invalidateQueries({ queryKey: ['caps'] });
    void client.invalidateQueries({ queryKey: ['services'] });
  }
  void client.invalidateQueries({ queryKey: [op.product] });
}

/** Keeps the operations store in sync with the `ops` live channel for the active profile. */
export function OperationsBridge() {
  const profileId = useSession((s) => s.profileId);
  const client = useQueryClient();
  useEffect(() => {
    if (!profileId) return;
    const { replaceAll, upsert } = useOperations.getState();
    replaceAll([]);
    return live.subscribe(
      'ops',
      { profileId, projectId: null },
      {},
      {
        data(payload) {
          const msg = payload as { kind: 'snapshot'; operations: OperationSummary[] } | { kind: 'update'; operation: OperationSummary };
          if (msg.kind === 'snapshot') {
            replaceAll(msg.operations);
            return;
          }
          const previous = upsert(msg.operation);
          const op = msg.operation;
          if (previous?.status === 'running' && op.status !== 'running') {
            invalidateFor(client, op);
            if (op.status === 'succeeded') toast.success(op.resource.displayName, { description: 'Finished.' });
            else if (op.status === 'failed')
              toast.error(op.resource.displayName, {
                description: op.error?.detail ?? 'The operation failed.',
                duration: Number.POSITIVE_INFINITY,
              });
            else toast(op.resource.displayName, { description: statusLabel[op.status] });
          }
        },
      },
    );
  }, [profileId, client]);
  return null;
}

/** The operations tray: running first, then this session's finished ones (SPEC-0001 CA-34). */
export function OperationsTray() {
  const byId = useOperations((s) => s.byId);
  const ops = useMemo(() => sortOperations(Object.values(byId)), [byId]);
  const running = ops.filter((o) => o.status === 'running').length;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label="Operations"
      className="w-[min(420px,calc(100vw-32px))]"
      trigger={
        <button
          type="button"
          aria-label={running > 0 ? `Operations, ${running} running` : 'Operations'}
          className="relative flex h-full items-center gap-2 px-4 text-ink-2 hover:bg-hover hover:text-ink"
        >
          <StackIcon size={18} aria-hidden />
          {running > 0 ? (
            <span className="tnum inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 font-mono text-[10px] text-ink-inverse">
              {running}
            </span>
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-rule px-3 py-2">
        <Legend>Operations</Legend>
        <span className="text-meta text-ink-3">{running > 0 ? `${running} running` : 'Nothing running'}</span>
      </div>
      <ol aria-live="polite" className="m-0 max-h-96 list-none overflow-y-auto p-0">
        {ops.length === 0 ? (
          <li className="px-3 py-4 text-dense text-ink-2">Deploys, enables and other long changes appear here while they run.</li>
        ) : null}
        {ops.map((op) => (
          <li key={op.id} className="border-b border-rule px-3 py-2 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusGlyph kind={statusKind[op.status]} label={statusLabel[op.status]} compact />
                  {op.resource.href ? (
                    <Link to={op.resource.href} className="truncate text-dense text-ink" onClick={() => setOpen(false)}>
                      {op.resource.displayName}
                    </Link>
                  ) : (
                    <span className="truncate text-dense text-ink">{op.resource.displayName}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-6 text-meta text-ink-3">
                  <span className="font-mono text-[11px]">{op.projectId}</span>
                  <Timestamp iso={op.startedAt} />
                  {op.progress !== null && op.status === 'running' ? <span className="tnum">{op.progress}%</span> : null}
                </div>
              </div>
              {op.error ? (
                <button
                  type="button"
                  className="shrink-0 text-meta text-ink-2 underline"
                  onClick={() => setExpanded(expanded === op.id ? null : op.id)}
                >
                  {expanded === op.id ? 'Hide' : 'Details'}
                </button>
              ) : null}
            </div>
            {op.error && expanded === op.id ? (
              <p className="mt-2 mb-0 pl-6 text-meta break-words text-redline-ink">{op.error.detail}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </Popover>
  );
}
