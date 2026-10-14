import type { ChannelDescriptorView, NotificationChannelView, UptimeCheckView } from '@nephoscope/contracts';
import { PaperPlaneTiltIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { ApiError } from '../../lib/api';
import {
  deleteChannel,
  deleteUptime,
  useChannelDescriptors,
  useChannels,
  useCreateChannel,
  useCreateUptime,
  useUptime,
  useVerifyChannel,
} from './api';

function PassRate({ rate }: { rate: number | null }) {
  if (rate === null) return <StatusGlyph kind="unknown" label="No data" />;
  const pct = `${(rate * 100).toFixed(rate === 1 ? 0 : 1)}%`;
  return <StatusGlyph kind={rate >= 0.99 ? 'ok' : rate >= 0.9 ? 'warn' : 'error'} label={`${pct} passed`} />;
}

function CreateUptimeSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<'HTTP' | 'HTTPS' | 'TCP'>('HTTPS');
  const [host, setHost] = useState('');
  const [path, setPath] = useState('/');
  const [port, setPort] = useState('');
  const [period, setPeriod] = useState<'60' | '300' | '600' | '900'>('60');
  const create = useCreateUptime(projectId);
  useEffect(() => {
    if (open) {
      setName('');
      setHost('');
      setPath('/');
      setPort('');
    }
  }, [open]);
  const ok = name.trim() && /^[A-Za-z0-9.-]+$/.test(host);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create uptime check"
      description="Google checks the target from several regions on the chosen period."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Name and host are required'}
            onClick={() =>
              create.mutate(
                {
                  displayName: name.trim(),
                  protocol,
                  host,
                  path: path || '/',
                  port: port ? Number(port) : undefined,
                  periodSeconds: Number(period) as 60 | 300 | 600 | 900,
                  timeoutSeconds: 10,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Create uptime check
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Protocol">
            <Select<'HTTP' | 'HTTPS' | 'TCP'>
              value={protocol}
              onValueChange={setProtocol}
              options={['HTTPS', 'HTTP', 'TCP'].map((p) => ({ value: p as 'HTTP', label: p }))}
            />
          </Field>
          <Field label="Host" required help="A host name or IP address.">
            <Input mono value={host} onChange={(e) => setHost(e.target.value.trim())} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          {protocol !== 'TCP' ? (
            <Field label="Path">
              <Input mono value={path} onChange={(e) => setPath(e.target.value)} />
            </Field>
          ) : (
            <span />
          )}
          <Field label="Port">
            <Input
              mono
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              placeholder={protocol === 'HTTPS' ? '443' : '80'}
            />
          </Field>
        </div>
        <Field label="Check every">
          <Select<'60' | '300' | '600' | '900'>
            value={period}
            onValueChange={setPeriod}
            options={[
              { value: '60', label: '1 minute' },
              { value: '300', label: '5 minutes' },
              { value: '600', label: '10 minutes' },
              { value: '900', label: '15 minutes' },
            ]}
          />
        </Field>
        <EquivalentCommand
          gcloud={`gcloud monitoring uptime create ${sh(name || 'NAME')} --resource-type=uptime-url --resource-labels=host=${host || 'HOST'},project_id=${projectId} --protocol=${protocol.toLowerCase()}${protocol !== 'TCP' ? ` --path=${sh(path || '/')}` : ''}${port ? ` --port=${port}` : ''} --period=${Number(period) / 60} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** Uptime checks with the last hour's pass rate (SPEC-0005 D-10). */
export function Uptime({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const q = useUptime(projectId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UptimeCheckView | null>(null);
  const columns: ResourceColumn<UptimeCheckView>[] = [
    {
      id: 'name',
      header: 'Check',
      hideable: false,
      sortValue: (c) => c.displayName,
      cell: (c) => <span className="font-medium text-ink">{c.displayName}</span>,
    },
    { id: 'rate', header: 'Last hour', width: '11rem', sortValue: (c) => c.passRate ?? -1, cell: (c) => <PassRate rate={c.passRate} /> },
    { id: 'protocol', header: 'Protocol', width: '6rem', cell: (c) => c.protocol },
    { id: 'target', header: 'Target', cell: (c) => <Mono value={`${c.target}${c.port ? `:${c.port}` : ''}${c.path ?? ''}`} /> },
    {
      id: 'period',
      header: 'Period',
      width: '6rem',
      align: 'right',
      cell: (c) => <span className="tnum">{c.periodSeconds ? `${c.periodSeconds / 60} min` : ''}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '5rem',
      hideable: false,
      cell: (c) => (
        <IconButton icon={TrashIcon} label={`Delete ${c.displayName}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(c)} />
      ),
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="monitoring-uptime"
          label="Uptime checks"
          rows={q.data ?? []}
          columns={columns}
          getRowId={(c) => c.name}
          emptyTitle="No uptime checks"
          emptyText="An uptime check requests a URL or opens a TCP port from several regions and records whether it answered."
          emptyAction={
            <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
              Create uptime check
            </Button>
          }
          toolbar={
            <div className="flex justify-end">
              <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
                Create uptime check
              </Button>
            </div>
          }
        />
      )}
      <CreateUptimeSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete uptime check"
        consequence="Checking stops. Alert policies on its metric stop getting data."
        expected={deleting?.id ?? ''}
        confirmLabel="Delete uptime check"
        command={deleting ? `gcloud monitoring uptime delete ${deleting.id} --project=${projectId}` : undefined}
        onConfirm={async (c) => {
          if (deleting) await deleteUptime(projectId, deleting.id, c);
          void q.refetch();
        }}
      />
    </div>
  );
}

function CreateChannelSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const descriptors = useChannelDescriptors(projectId, open);
  const [type, setType] = useState('email');
  const [name, setName] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const create = useCreateChannel(projectId);
  useEffect(() => {
    if (open) {
      setName('');
      setLabels({});
    }
  }, [open]);
  const d: ChannelDescriptorView | undefined = descriptors.data?.find((x) => x.type === type);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create notification channel"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!!readOnly || !name.trim() || !d}
            disabledReason={readOnly ?? 'Pick a type and name the channel'}
            onClick={() => create.mutate({ type, displayName: name.trim(), labels }, { onSuccess: () => onOpenChange(false) })}
          >
            Create channel
          </Button>
        </>
      }
    >
      {descriptors.isPending ? (
        <DelayedSkeleton rows={4} />
      ) : descriptors.error instanceof ApiError ? (
        <ProblemState problem={descriptors.error.problem} onRetry={() => void descriptors.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Type">
            <Select<string>
              value={type}
              onValueChange={(t) => {
                setType(t);
                setLabels({});
              }}
              options={(descriptors.data ?? []).map((x) => ({ value: x.type, label: x.displayName }))}
            />
          </Field>
          {d?.description ? <p className="m-0 text-meta text-ink-2">{d.description}</p> : null}
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {d?.labels.map((l) => (
            <Field key={l.key} label={l.key} help={l.description}>
              <Input mono value={labels[l.key] ?? ''} onChange={(e) => setLabels((p) => ({ ...p, [l.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Notification channels (SPEC-0005 D-10). */
export function Channels({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const q = useChannels(projectId);
  const verify = useVerifyChannel(projectId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NotificationChannelView | null>(null);
  const columns: ResourceColumn<NotificationChannelView>[] = [
    {
      id: 'name',
      header: 'Channel',
      hideable: false,
      sortValue: (c) => c.displayName,
      cell: (c) => <span className="font-medium text-ink">{c.displayName}</span>,
    },
    { id: 'type', header: 'Type', width: '9rem', sortValue: (c) => c.type, cell: (c) => c.type },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (c) => (c.enabled ? <StatusGlyph kind="ok" label="Enabled" /> : <StatusGlyph kind="paused" label="Disabled" />),
    },
    {
      id: 'verification',
      header: 'Verification',
      width: '9rem',
      cell: (c) =>
        c.verificationStatus === 'VERIFIED' ? (
          <StatusGlyph kind="ok" label="Verified" />
        ) : c.verificationStatus === 'UNVERIFIED' ? (
          <StatusGlyph kind="warn" label="Unverified" />
        ) : (
          <span className="text-ink-3">Not needed</span>
        ),
    },
    {
      id: 'labels',
      header: 'Settings',
      cell: (c) => (
        <Mono
          value={Object.entries(c.labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '8rem',
      hideable: false,
      cell: (c) => (
        <span className="flex gap-1">
          {c.verificationStatus === 'UNVERIFIED' ? (
            <IconButton
              icon={PaperPlaneTiltIcon}
              label={`Send verification to ${c.displayName}`}
              size="sm"
              disabled={!!readOnly}
              onClick={() => verify.mutate(c.id)}
            />
          ) : null}
          <IconButton icon={TrashIcon} label={`Delete ${c.displayName}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(c)} />
        </span>
      ),
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="monitoring-channels"
          label="Notification channels"
          rows={q.data ?? []}
          columns={columns}
          getRowId={(c) => c.name}
          emptyTitle="No notification channels"
          emptyText="A channel is where alert policies send notifications: email, Slack, PagerDuty, Pub/Sub, webhooks."
          emptyAction={
            <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
              Create channel
            </Button>
          }
          toolbar={
            <div className="flex justify-end">
              <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
                Create channel
              </Button>
            </div>
          }
        />
      )}
      <CreateChannelSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete notification channel"
        consequence="Policies that use it stop notifying there. Google refuses the deletion while a policy still names the channel."
        expected={deleting?.id ?? ''}
        confirmLabel="Delete channel"
        onConfirm={async (c) => {
          if (deleting) await deleteChannel(projectId, deleting.id, c);
          void q.refetch();
        }}
      />
    </div>
  );
}
