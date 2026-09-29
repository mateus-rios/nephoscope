import type { Problem } from '@nephoscope/contracts';
import { DotsThreeIcon, PlusIcon, RocketIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../design/Button';
import { ConfirmDestructive } from '../design/ConfirmDestructive';
import { type Note, Notes, Section, TitleBlock } from '../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../design/Feedback';
import { Field, Input, Select, Switch, Textarea } from '../design/Form';
import { JsonTree } from '../design/JsonTree';
import { Dialog, Menu, MenuItem, MenuSeparator, Popover, Sheet } from '../design/Overlays';
import { ProfileMark } from '../design/ProfileMark';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { RevisionMark, Spinner, Stamp, StatusGlyph, type StatusKind } from '../design/Status';
import { TabNav } from '../design/TabNav';
import { Tooltip } from '../design/Tooltip';
import { Chip, CopyButton, Kbd, Mono, Timestamp } from '../design/Values';
import { ViewScope } from '../design/ViewScope';

const statusKinds: [StatusKind, string][] = [
  ['ok', 'Ready'],
  ['warn', 'Degraded'],
  ['error', 'Failed'],
  ['running', 'Deploying'],
  ['pending', 'Queued'],
  ['paused', 'Paused'],
  ['unknown', 'Unknown'],
];

const problems: Problem[] = [
  {
    type: 'about:blank',
    title: 'Cloud Run Admin API is disabled',
    status: 403,
    detail: 'Cloud Run Admin API has not been used in project demo-123 before or it is disabled.',
    code: 'API_DISABLED',
    service: 'run.googleapis.com',
    serviceTitle: 'Cloud Run Admin API',
    consumer: 'projects/123456789',
    retryable: false,
  },
  {
    type: 'about:blank',
    title: 'Permission denied',
    status: 403,
    detail: 'The key may not list services in this project.',
    code: 'PERMISSION_DENIED',
    permission: 'run.services.list',
    retryable: false,
  },
];

interface Row {
  name: string;
  region: string;
  status: StatusKind;
  label: string;
  updated: string;
}

const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
  name: `service-${String(i + 1).padStart(2, '0')}`,
  region: ['us-central1', 'europe-west1', 'southamerica-east1'][i % 3] as string,
  status: (['ok', 'ok', 'running', 'warn', 'error'] as StatusKind[])[i % 5] as StatusKind,
  label: ['Ready', 'Ready', 'Deploying', 'Degraded', 'Failed'][i % 5] as string,
  updated: new Date(Date.UTC(2026, 8, 28, 12) - i * 3_600_000).toISOString(),
}));

const columns: ResourceColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    hideable: false,
    sortValue: (r) => r.name,
    cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    width: '9rem',
    sortValue: (r) => r.status,
    cell: (r) => <StatusGlyph kind={r.status} label={r.label} />,
  },
  { id: 'region', header: 'Region', width: '11rem', sortValue: (r) => r.region, cell: (r) => <Mono value={r.region} /> },
  { id: 'updated', header: 'Updated', width: '8rem', sortValue: (r) => r.updated, cell: (r) => <Timestamp iso={r.updated} /> },
];

const notes: Note[] = [
  { id: 'n1', tone: 'info', text: 'Emulators are in use for firestore.' },
  { id: 'n2', tone: 'warn', text: 'The profile prod-deployer is read-only.' },
  {
    id: 'n3',
    tone: 'error',
    text: 'Saved profiles cannot be decrypted.',
    action: (
      <Button size="sm" variant="ghost">
        Reset saved profiles
      </Button>
    ),
  },
  { id: 'n4', tone: 'unknown', text: 'The permission check failed.' },
];

const sample = {
  name: 'projects/demo-123/locations/us-central1/services/api',
  generation: '42',
  labels: { env: 'prod', team: 'core' },
  template: {
    containers: [{ image: 'us-docker.pkg.dev/demo/api:1.4.2', ports: [{ containerPort: 8080 }] }],
    scaling: { minInstanceCount: 0, maxInstanceCount: 10 },
  },
  traffic: [{ percent: 100, type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' }],
  reconciling: false,
  uri: null,
};

function Specimens({ theme }: { theme: 'light' | 'dark' }) {
  const [text, setText] = useState('');
  const [region, setRegion] = useState<'us-central1' | 'europe-west1'>('us-central1');
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState('overview');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  return (
    <div data-theme={theme} className="border-b border-rule bg-sheet text-ink">
      <TitleBlock
        title={theme === 'light' ? 'Plate A: drafting film' : 'Plate B: blueprint'}
        status={<StatusGlyph kind="ok" label="Ready" />}
        actions={
          <>
            <Button icon={RocketIcon}>Deploy revision</Button>
            <Button variant="commit" icon={PlusIcon}>
              Create service
            </Button>
          </>
        }
        cells={[
          { label: 'Project id', value: <Mono value="demo-123" copy />, mono: true },
          { label: 'Region', value: 'us-central1' },
          { label: 'Created', value: <Timestamp iso="2026-03-02T10:00:00Z" /> },
          { label: 'Acting as', value: <Mono value="deployer@demo-123.iam.gserviceaccount.com" />, wide: true },
        ]}
      />
      <Notes notes={notes} />

      <ViewScope name="kit-buttons">
        <Section
          title="Buttons"
          description="Variants and states. The danger commit sits in its own view here; a real view has one commit."
        >
          <div className="flex flex-wrap items-center gap-2 px-6">
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={TrashIcon}>
              Delete 3 documents
            </Button>
            <Button loading>Saving</Button>
            <Button disabled disabledReason="Requires run.services.update">
              Disabled with reason
            </Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <IconButton icon={DotsThreeIcon} label="More actions" />
            <IconButton icon={DotsThreeIcon} label="Pressed" active />
          </div>
        </Section>
      </ViewScope>

      <Section title="Fields">
        <div className="grid max-w-3xl grid-cols-1 gap-4 px-6 sm:grid-cols-2">
          <Field label="Service name" help="Lowercase letters, digits and hyphens.">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="api" />
          </Field>
          <Field label="Image" error="The image must include a registry host.">
            <Input mono defaultValue="api:latest" aria-invalid />
          </Field>
          <Field label="Region">
            <Select
              value={region}
              onValueChange={setRegion}
              options={[
                { value: 'us-central1', label: 'us-central1 (Iowa)' },
                { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
              ]}
            />
          </Field>
          <Field label="Disabled">
            <Input disabled defaultValue="Cannot change" />
          </Field>
          <Field label="Arguments" className="sm:col-span-2">
            <Textarea mono rows={3} defaultValue={'{\n  "orderId": 42\n}'} />
          </Field>
          <Switch
            checked={on}
            onCheckedChange={setOn}
            label="Allow unauthenticated invocations"
            description="Anyone on the internet can call the service URL."
          />
          <Switch checked={false} onCheckedChange={() => {}} label="Disabled switch" disabled />
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-col gap-3 px-6">
          <div className="flex flex-wrap items-center gap-4">
            {statusKinds.map(([k, l]) => (
              <StatusGlyph key={k} kind={k} label={l} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {statusKinds.map(([k, l]) => (
              <StatusGlyph key={k} kind={k} label={l} compact />
            ))}
            <Spinner label="Loading revisions" />
            <RevisionMark />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Stamp>Environment</Stamp>
            <Stamp tone="redline">Read-only</Stamp>
            <Chip>region: us-central1</Chip>
            <Chip mono onRemove={() => {}}>
              env=prod
            </Chip>
            <Kbd>Ctrl K</Kbd>
            <Kbd>g r</Kbd>
            <CopyButton value="demo-123" label="Copy project id" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(['none', 'gray', 'blue', 'green', 'amber', 'red', 'violet'] as const).map((t, i) => (
              <ProfileMark key={t} seed={`kit-${i}`} principal={`${t}@demo.iam.gserviceaccount.com`} name={t} colorTag={t} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <TabNav
          label="Service sections"
          active={tab}
          onSelect={setTab}
          items={[
            { key: 'overview', label: 'Overview' },
            { key: 'revisions', label: 'Revisions', count: 12 },
            { key: 'logs', label: 'Logs' },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap items-center gap-2 px-6">
          <Tooltip content="Tooltips wait 500 ms, then open instantly while you move across">
            <Button variant="ghost">Hover for a tooltip</Button>
          </Tooltip>
          <Menu trigger={<Button>Open a menu</Button>}>
            <MenuItem>Copy name</MenuItem>
            <MenuItem>Open logs</MenuItem>
            <MenuSeparator />
            <MenuItem className="text-redline-ink">Delete service</MenuItem>
          </Menu>
          <Popover trigger={<Button>Open a popover</Button>} label="Popover sample">
            <p className="m-0 max-w-64 p-3 text-dense text-ink-2">Popovers grow from their trigger.</p>
          </Popover>
          <DialogSample />
          <SheetSample />
          <ConfirmSample />
          <Button onClick={() => toast.success('Revision api-00042 is serving 100% of traffic')}>Show a toast</Button>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <EmptyState icon={RocketIcon} title="No services in this region" action={<Button icon={PlusIcon}>Create service</Button>}>
            Deploy a container image to create the first service.
          </EmptyState>
          <DelayedSkeleton rows={4} className="px-6 py-4" />
          {problems.map((p) => (
            <ProblemState key={p.code} problem={p} onRetry={() => {}} enableAction={<Button>Enable Cloud Run Admin API</Button>} />
          ))}
        </div>
      </Section>

      <Section title="Table">
        <ResourceTable
          tableId={`kit-${theme}`}
          label="Sample services"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.name}
          itemColumn
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          emptyTitle="No services"
        />
      </Section>

      <Section title="JSON">
        <div className="px-6">
          <JsonTree value={sample} label="Service resource" height={280} />
        </div>
      </Section>
    </div>
  );
}

function DialogSample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open a dialog</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Split traffic"
        description="Send part of the traffic to another revision."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="commit" onClick={() => setOpen(false)}>
              Save traffic split
            </Button>
          </>
        }
      >
        <Field label="Percent to api-00042">
          <Input mono defaultValue="50" inputMode="numeric" />
        </Field>
      </Dialog>
    </>
  );
}

function SheetSample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open a sheet</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Edit environment"
        description="Changes deploy a new revision."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="commit" onClick={() => setOpen(false)}>
              Deploy revision
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="NODE_ENV">
            <Input mono defaultValue="production" />
          </Field>
          <Field label="LOG_LEVEL">
            <Input mono defaultValue="info" />
          </Field>
        </div>
      </Sheet>
    </>
  );
}

function ConfirmSample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Open a typed confirmation
      </Button>
      <ConfirmDestructive
        open={open}
        onOpenChange={setOpen}
        title="Delete service"
        consequence="The service api and all its revisions are deleted. Its URL stops answering."
        expected="api"
        confirmLabel="Delete service"
        command="gcloud run services delete api --region=us-central1"
        onConfirm={async () => {
          toast('Nothing was deleted: this is the kit.');
        }}
      />
    </>
  );
}

/** Development only: every primitive and state on both plates (SPEC-0002 CA-26). */
export function KitPage() {
  return (
    <div className="pb-16">
      <ViewScope name="kit-light">
        <Specimens theme="light" />
      </ViewScope>
      <ViewScope name="kit-dark">
        <Specimens theme="dark" />
      </ViewScope>
    </div>
  );
}
