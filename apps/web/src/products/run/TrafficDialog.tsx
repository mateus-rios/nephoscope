import type { Revision, RunService, TrafficTarget } from '@nephoscope/contracts';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Input, Select } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { useSetTraffic } from './api';
import { trafficCommand } from './commands';

interface Row {
  key: number;
  target: string;
  percent: string;
  tag: string;
}

const LATEST = '__latest__';
let nextRowKey = 0;

function toRows(traffic: TrafficTarget[]): Row[] {
  return traffic.map((t) => ({
    key: nextRowKey++,
    target: t.type === 'LATEST' ? LATEST : (t.revision ?? ''),
    percent: String(t.percent),
    tag: t.tag ?? '',
  }));
}

function toTargets(rows: Row[]): TrafficTarget[] {
  return rows.map((r) =>
    r.target === LATEST
      ? { type: 'LATEST', revision: null, percent: Number(r.percent) || 0, tag: r.tag.trim() || null }
      : { type: 'REVISION', revision: r.target, percent: Number(r.percent) || 0, tag: r.tag.trim() || null },
  );
}

/** "Revision abc-00012 will get 50%, abc-00011 will get 50%" (SPEC-0003 CA-04). */
export function trafficSentence(targets: TrafficTarget[], latestReady: string | null): string {
  const parts = targets
    .filter((t) => t.percent > 0)
    .map(
      (t) =>
        `${t.type === 'LATEST' ? `the latest revision${latestReady ? ` (now ${latestReady})` : ''}` : `revision ${t.revision}`} will get ${t.percent}%`,
    );
  const tagged = targets.filter((t) => t.tag).map((t) => `${t.tag} points to ${t.type === 'LATEST' ? 'the latest revision' : t.revision}`);
  const text = [...parts, ...tagged].join(', ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
}

interface TrafficDialogProps {
  projectId: string;
  service: RunService;
  revisions: Revision[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnlyReason: string | null;
}

/** Traffic split and tags (SPEC-0003 D-03, CA-04). */
export function TrafficDialog({ projectId, service, revisions, open, onOpenChange, readOnlyReason }: TrafficDialogProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(service.traffic));
  const mutation = useSetTraffic(projectId, service.location, service.id);
  useEffect(() => {
    if (open) setRows(toRows(service.traffic));
  }, [open, service.traffic]);

  const targets = toTargets(rows);
  const total = targets.reduce((s, t) => s + t.percent, 0);
  const badPercent = rows.some((r) => !/^\d{1,3}$/.test(r.percent) || Number(r.percent) > 100);
  const missingTarget = rows.some((r) => !r.target);
  const duplicateTags = new Set(targets.map((t) => t.tag).filter(Boolean)).size !== targets.filter((t) => t.tag).length;
  const badTag = rows.some((r) => r.tag && !/^[a-z]([-a-z0-9]{0,45}[a-z0-9])?$/.test(r.tag));
  const valid = total === 100 && !badPercent && !missingTarget && !duplicateTags && !badTag;
  const options = [
    { value: LATEST, label: 'Latest revision' },
    ...revisions.filter((r) => r.status !== 'failed').map((r) => ({ value: r.id, label: r.id })),
  ];
  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={`Traffic of ${service.id}`}
      description="Split requests between revisions in whole percentages. A tag gives a revision its own URL."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            disabled={!valid || !!readOnlyReason}
            disabledReason={readOnlyReason ?? (total !== 100 ? `The split adds up to ${total}%, not 100%` : 'Fix the rows marked in red')}
            loading={mutation.isPending}
            onClick={() => mutation.mutate({ traffic: targets, etag: service.etag ?? undefined }, { onSuccess: () => onOpenChange(false) })}
          >
            Save traffic split
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5">
          <Legend>Target</Legend>
          <Legend>Percent</Legend>
          <Legend>Tag</Legend>
          <span />
          {rows.map((r, i) => (
            <div key={r.key} className="contents">
              <Select<string>
                value={r.target}
                onValueChange={(v) => update(i, { target: v })}
                options={[{ value: '', label: 'Choose a revision' }, ...options]}
                aria-label={`Target ${i + 1}`}
              />
              <Input
                mono
                value={r.percent}
                onChange={(e) => update(i, { percent: e.target.value.replace(/[^\d]/g, '') })}
                inputMode="numeric"
                aria-label={`Percent ${i + 1}`}
                aria-invalid={!/^\d{1,3}$/.test(r.percent) || undefined}
              />
              <Input
                mono
                value={r.tag}
                onChange={(e) => update(i, { tag: e.target.value })}
                placeholder="None"
                aria-label={`Tag ${i + 1}`}
                aria-invalid={(r.tag && !/^[a-z]([-a-z0-9]{0,45}[a-z0-9])?$/.test(r.tag)) || undefined}
              />
              <IconButton
                icon={TrashIcon}
                label={`Remove row ${i + 1}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                disabled={rows.length === 1}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            icon={PlusIcon}
            onClick={() => setRows((prev) => [...prev, { key: nextRowKey++, target: '', percent: '0', tag: '' }])}
          >
            Add a target
          </Button>
          <span className={`ml-auto tnum text-dense ${total === 100 ? 'text-ink-2' : 'text-redline-ink'}`}>Total {total}%</span>
        </div>
        {duplicateTags ? <p className="m-0 text-meta text-redline-ink">Each tag can be used once.</p> : null}
        {badTag ? (
          <p className="m-0 text-meta text-redline-ink">Tags use lowercase letters, digits and hyphens, starting with a letter.</p>
        ) : null}
        {valid ? <p className="m-0 text-dense text-ink">{trafficSentence(targets, service.latestReadyRevision)}</p> : null}
        <EquivalentCommand {...trafficCommand(projectId, service.location, service.id, targets)} />
      </div>
    </Dialog>
  );
}
