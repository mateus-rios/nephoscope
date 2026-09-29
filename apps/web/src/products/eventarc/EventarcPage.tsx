import type { EventarcTrigger } from '@nephoscope/contracts';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Tooltip } from '../../design/Tooltip';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useRunServices } from '../run/api';
import { readOnlyReason } from '../run/common';
import { RUN_REGIONS } from '../run/DeploySheet';
import { useWorkflows } from '../workflows/api';
import { deleteTrigger, destinationText, useCreateTrigger, useProviders, useTriggers } from './api';

function CreateTriggerSheet({
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
  const [id, setId] = useState('');
  const [region, setRegion] = useState('us-central1');
  const [provider, setProvider] = useState('');
  const [eventType, setEventType] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [destKind, setDestKind] = useState<'cloudRun' | 'workflow'>('cloudRun');
  const [service, setService] = useState('');
  const [path, setPath] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [sa, setSa] = useState('');
  const providers = useProviders(projectId, region, open);
  const runServices = useRunServices(projectId);
  const workflows = useWorkflows(projectId);
  const create = useCreateTrigger(projectId);
  useEffect(() => {
    if (open) {
      setId('');
      setProvider('');
      setEventType('');
      setAttrs({});
    }
  }, [open]);
  const p = providers.data?.find((x) => x.id === provider);
  const type = p?.eventTypes.find((t) => t.type === eventType);
  const services = (runServices.data?.pages.flatMap((pg) => pg.items) ?? []).filter((s) => s.location === region);
  const regionWorkflows = (workflows.data?.items ?? []).filter((w) => w.location === region);
  const missing = (type?.filteringAttributes ?? []).filter((a) => a.required && !attrs[a.attribute]?.trim()).map((a) => a.attribute);
  const idOk = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(id);
  const destOk = destKind === 'cloudRun' ? !!service : !!workflow;
  const valid = idOk && !!eventType && missing.length === 0 && destOk && sa.includes('@');
  const filters = [
    { attribute: 'type', value: eventType },
    ...Object.entries(attrs)
      .filter(([, v]) => v.trim())
      .map(([attribute, value]) => ({ attribute, value: value.trim() })),
  ];
  const gcloudFilters = filters.map((f) => `--event-filters=${f.attribute}=${f.value}`).join(' ');
  const gcloudDest =
    destKind === 'cloudRun'
      ? `--destination-run-service=${service} --destination-run-region=${region}${path ? ` --destination-run-path=${path}` : ''}`
      : `--destination-workflow=${workflow.split('/').pop()} --destination-workflow-location=${region}`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create trigger"
      description="Routes events from a Google source to a Cloud Run service or a workflow."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!valid || !!readOnly}
            disabledReason={readOnly ?? (missing.length ? `Fill ${missing.join(', ')}` : 'Fill every required field')}
            onClick={() =>
              create.mutate(
                {
                  id,
                  region,
                  filters,
                  destination:
                    destKind === 'cloudRun'
                      ? { kind: 'cloudRun', service, region, path: path || undefined }
                      : { kind: 'workflow', workflow },
                  serviceAccount: sa.trim(),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Create trigger
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required error={id && !idOk ? 'Lowercase letters, digits and hyphens.' : undefined}>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </Field>
          <Field label="Region" required>
            <Input mono value={region} onChange={(e) => setRegion(e.target.value)} list="nephoscope-eventarc-regions" />
          </Field>
          <datalist id="nephoscope-eventarc-regions">
            {['global', ...RUN_REGIONS].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Event
          </Legend>
          {providers.error instanceof ApiError ? <ProblemState problem={providers.error.problem} className="p-0" /> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Select<string>
                value={provider}
                onValueChange={(v) => {
                  setProvider(v);
                  setEventType('');
                  setAttrs({});
                }}
                options={[
                  { value: '', label: providers.isPending ? 'Loading the catalog' : 'Choose a provider' },
                  ...(providers.data ?? []).map((x) => ({ value: x.id, label: x.displayName })),
                ]}
              />
            </Field>
            <Field label="Event type">
              <Select<string>
                value={eventType}
                onValueChange={(v) => {
                  setEventType(v);
                  setAttrs({});
                }}
                disabled={!p}
                options={[
                  { value: '', label: 'Choose an event type' },
                  ...(p?.eventTypes ?? []).map((t) => ({ value: t.type, label: t.description || t.type })),
                ]}
              />
            </Field>
          </div>
          {type?.filteringAttributes
            .filter((a) => a.attribute !== 'type')
            .map((a) => (
              <Field
                key={a.attribute}
                label={a.attribute.charAt(0).toUpperCase() + a.attribute.slice(1)}
                help={a.description}
                required={a.required}
              >
                <Input
                  mono
                  value={attrs[a.attribute] ?? ''}
                  onChange={(e) => setAttrs((prev) => ({ ...prev, [a.attribute]: e.target.value }))}
                />
              </Field>
            ))}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Destination
          </Legend>
          <Field label="Type" className="max-w-xs">
            <Select<'cloudRun' | 'workflow'>
              value={destKind}
              onValueChange={setDestKind}
              options={[
                { value: 'cloudRun', label: 'Cloud Run service' },
                { value: 'workflow', label: 'Workflow' },
              ]}
            />
          </Field>
          {destKind === 'cloudRun' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service" help={services.length === 0 ? `No services in ${region}.` : undefined}>
                <Select<string>
                  value={service}
                  onValueChange={setService}
                  options={[{ value: '', label: 'Choose a service' }, ...services.map((s) => ({ value: s.id, label: s.id }))]}
                />
              </Field>
              <Field label="Path" help="Optional, such as /events.">
                <Input mono value={path} onChange={(e) => setPath(e.target.value)} />
              </Field>
            </div>
          ) : (
            <Field label="Workflow" help={regionWorkflows.length === 0 ? `No workflows in ${region}.` : undefined}>
              <Select<string>
                value={workflow}
                onValueChange={setWorkflow}
                options={[{ value: '', label: 'Choose a workflow' }, ...regionWorkflows.map((w) => ({ value: w.name, label: w.id }))]}
              />
            </Field>
          )}
          <Field label="Service account" required help="Needs roles/eventarc.eventReceiver, and permission to invoke the destination.">
            <Input mono value={sa} onChange={(e) => setSa(e.target.value)} />
          </Field>
        </fieldset>
        <EquivalentCommand
          gcloud={`gcloud eventarc triggers create ${id || 'NAME'} --location=${region} --project=${projectId} ${gcloudFilters} ${gcloudDest} --service-account=${sa || 'SA'}`}
        />
      </div>
    </Sheet>
  );
}

/** Eventarc triggers (SPEC-0003 D-14, CA-28). */
export function EventarcPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useTriggers(projectId);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EventarcTrigger | null>(null);
  const location = useFacet('location');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Eventarc · Nephoscope';
  }, []);
  const all = query.data?.items ?? [];
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (t) =>
          (location === 'all' || t.location === location) &&
          (!q ||
            t.id.includes(q) ||
            (t.eventType ?? '').toLowerCase().includes(q) ||
            destinationText(t.destination).toLowerCase().includes(q)),
      ),
    [all, location, q],
  );
  const columns: ResourceColumn<EventarcTrigger>[] = [
    {
      id: 'name',
      header: 'Trigger',
      hideable: false,
      sortValue: (t) => t.id,
      cell: (t) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{t.id}</span>
          {t.conditions.length > 0 ? (
            <Tooltip content={t.conditions.map((c) => c.message).join(' ')}>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target so keyboard users can read the tooltip. */}
              <span className="inline-flex" tabIndex={0}>
                <StatusGlyph kind="warn" label="Needs attention" compact />
              </span>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      id: 'event',
      header: 'Event type',
      sortValue: (t) => t.eventType ?? '',
      cell: (t) => <span className="truncate font-mono text-[12px] text-ink-2">{t.eventType}</span>,
    },
    {
      id: 'filters',
      header: 'Filters',
      width: '12rem',
      cell: (t) => (
        <span className="truncate text-meta text-ink-2">
          {t.filters
            .filter((f) => f.attribute !== 'type')
            .map((f) => `${f.attribute}=${f.value}`)
            .join(', ')}
        </span>
      ),
    },
    {
      id: 'destination',
      header: 'Destination',
      sortValue: (t) => destinationText(t.destination),
      cell: (t) => <span className="truncate text-ink">{destinationText(t.destination)}</span>,
    },
    { id: 'location', header: 'Location', width: '9rem', sortValue: (t) => t.location, cell: (t) => <Mono value={t.location} /> },
    {
      id: 'created',
      header: 'Created',
      width: '8rem',
      defaultHidden: true,
      sortValue: (t) => t.createTime ?? '',
      cell: (t) => <Timestamp iso={t.createTime} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (t) => (
        <span>
          <Button size="sm" variant="ghost" icon={TrashIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setDeleting(t)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Eventarc"
        subtitle="Triggers that deliver events from Google services to Cloud Run and Workflows."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create trigger
          </Button>
        }
      />
      <Notes notes={partialNote(query.data?.unreachable)} />
      <div className="pt-3">
        {query.isPending ? (
          <DelayedSkeleton />
        ) : query.error instanceof ApiError ? (
          <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
        ) : (
          <ResourceTable
            tableId="eventarc"
            label="Triggers"
            rows={rows}
            columns={columns}
            getRowId={(t) => t.name}
            filtered={rows.length !== all.length}
            emptyTitle="No triggers"
            emptyText="A trigger sends events, such as a new object in a bucket, to a service or a workflow."
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name, event or destination"
                  aria-label="Filter triggers"
                  className="w-72"
                />
                <Facet label="Location" param="location" rows={all} valueFor={(t) => t.location} />
                <span className="ml-auto">
                  <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
                </span>
              </div>
            }
          />
        )}
      </div>
      <CreateTriggerSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete trigger"
        consequence={`Events stop reaching ${deleting ? destinationText(deleting.destination) : ''}. The event source is not changed.`}
        expected={deleting?.id ?? ''}
        confirmLabel="Delete trigger"
        command={
          deleting ? `gcloud eventarc triggers delete ${deleting.id} --location=${deleting.location} --project=${projectId}` : undefined
        }
        onConfirm={async (confirm) => {
          if (!deleting) return;
          const { operation } = await deleteTrigger(projectId, deleting.location, deleting.id, confirm);
          useOperations.getState().upsert(operation);
        }}
      />
    </div>
  );
}
