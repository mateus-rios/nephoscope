import type { LogMetric } from '@nephoscope/contracts';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { KeyValueEditor } from '../../kit/KeyValueEditor';
import { ApiError } from '../../lib/api';
import { deleteLogMetric, useLogMetrics, useSaveLogMetric } from './api';

function MetricSheet({
  projectId,
  metric,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  metric: LogMetric | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'counter' | 'distribution'>('counter');
  const [unit, setUnit] = useState('');
  const [valueExtractor, setValueExtractor] = useState('');
  const [labels, setLabels] = useState<{ name: string; value: string }[]>([]);
  const [disabled, setDisabled] = useState(false);
  const save = useSaveLogMetric(projectId, metric?.name ?? null);
  useEffect(() => {
    if (!open) return;
    setName(metric?.name ?? '');
    setDescription(metric?.description ?? '');
    setFilter(metric?.filter ?? '');
    setKind(metric?.kind ?? 'counter');
    setUnit(metric?.unit ?? '');
    setValueExtractor(metric?.valueExtractor ?? '');
    setLabels(Object.entries(metric?.labelExtractors ?? {}).map(([k, v]) => ({ name: k, value: v })));
    setDisabled(metric?.disabled ?? false);
  }, [open, metric]);
  const nameOk = /^[A-Za-z0-9_.\-/]{1,100}$/.test(name);
  const ok = nameOk && filter.trim() && (kind === 'counter' || valueExtractor.trim());
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={metric ? `Edit ${metric.name}` : 'Create log-based metric'}
      description="Cloud Monitoring counts or measures the log entries that match the filter."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Name, filter and, for distributions, a value extractor are required'}
            onClick={() =>
              save.mutate(
                {
                  name,
                  description: description || undefined,
                  filter,
                  kind,
                  unit: unit || undefined,
                  valueExtractor: kind === 'distribution' ? valueExtractor : undefined,
                  labelExtractors: Object.fromEntries(labels.filter((l) => l.name.trim()).map((l) => [l.name.trim(), l.value])),
                  disabled,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {metric ? 'Save metric' : 'Create metric'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <Input mono value={name} onChange={(e) => setName(e.target.value)} disabled={!!metric} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select<'counter' | 'distribution'>
              value={kind}
              onValueChange={setKind}
              options={[
                { value: 'counter', label: 'Counter: matching entries' },
                { value: 'distribution', label: 'Distribution: a value per entry' },
              ]}
            />
          </Field>
          <Field label="Unit" help="Such as 1, ms or By.">
            <Input mono value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <Field label="Filter (LQL)" required>
          <CodeEditor value={filter} onChange={setFilter} language="lql" height={100} label="Metric filter" />
        </Field>
        {kind === 'distribution' ? (
          <Field
            label="Value extractor"
            required
            help='Such as EXTRACT(jsonPayload.latency_ms) or REGEXP_EXTRACT(textPayload, "took (\d+)ms").'
          >
            <Input mono value={valueExtractor} onChange={(e) => setValueExtractor(e.target.value)} />
          </Field>
        ) : null}
        <KeyValueEditor label="Label extractors" keyLabel="Label" rows={labels} onChange={setLabels} />
        <Switch checked={disabled} onCheckedChange={setDisabled} label="Disabled" />
        <EquivalentCommand
          gcloud={`gcloud logging metrics ${metric ? 'update' : 'create'} ${name || 'METRIC'} --log-filter=${sh(filter || 'FILTER')} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** Log-based metrics (SPEC-0005 D-05). */
export function LogMetrics({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const metrics = useLogMetrics(projectId);
  const [editing, setEditing] = useState<LogMetric | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LogMetric | null>(null);
  const columns: ResourceColumn<LogMetric>[] = [
    {
      id: 'name',
      header: 'Metric',
      hideable: false,
      sortValue: (m) => m.name,
      cell: (m) => <span className="truncate font-medium text-ink">{m.name}</span>,
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (m) => (m.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Active" />),
    },
    {
      id: 'kind',
      header: 'Type',
      width: '8rem',
      sortValue: (m) => m.kind,
      cell: (m) => (m.kind === 'counter' ? 'Counter' : 'Distribution'),
    },
    { id: 'filter', header: 'Filter', cell: (m) => <Mono value={m.filter} /> },
    {
      id: 'labels',
      header: 'Labels',
      width: '10rem',
      cell: (m) => Object.keys(m.labelExtractors).join(', ') || <span className="text-ink-3">None</span>,
    },
    { id: 'updated', header: 'Updated', width: '9rem', defaultHidden: true, cell: (m) => <Timestamp iso={m.updateTime} /> },
    {
      id: 'chart',
      header: 'Chart',
      width: '8rem',
      cell: (m) => (
        <Link to={`/p/${projectId}/monitoring` as string} search={{ tab: 'explorer', metric: m.metricType }} className="text-meta">
          Open in Metrics Explorer
        </Link>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '5rem',
      hideable: false,
      cell: (m) => (
        <IconButton icon={TrashIcon} label={`Delete ${m.name}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(m)} />
      ),
    },
  ];
  return (
    <div className="pt-3">
      {metrics.isPending ? (
        <DelayedSkeleton />
      ) : metrics.error instanceof ApiError ? (
        <ProblemState problem={metrics.error.problem} onRetry={() => void metrics.refetch()} />
      ) : (
        <ResourceTable
          tableId="logging-metrics"
          label="Log-based metrics"
          rows={metrics.data ?? []}
          columns={columns}
          getRowId={(m) => m.name}
          onOpen={(m) => setEditing(m)}
          emptyTitle="No log-based metrics"
          emptyText="A log-based metric turns matching log entries into a Cloud Monitoring time series you can chart and alert on."
          emptyAction={
            <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing('new')}>
              Create log-based metric
            </Button>
          }
          toolbar={
            <div className="flex justify-end">
              <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing('new')}>
                Create log-based metric
              </Button>
            </div>
          }
        />
      )}
      <MetricSheet
        projectId={projectId}
        metric={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        readOnly={readOnly}
      />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete log-based metric"
        consequence="The metric stops collecting. Alert policies and charts that use it stop getting data."
        expected={deleting?.name.split('/').pop() ?? ''}
        confirmLabel="Delete metric"
        command={deleting ? `gcloud logging metrics delete ${deleting.name} --project=${projectId}` : undefined}
        onConfirm={async (c) => {
          if (deleting) await deleteLogMetric(projectId, deleting.name, c);
          void metrics.refetch();
        }}
      />
    </div>
  );
}
