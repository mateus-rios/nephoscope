import {
  type CreateDnsZone,
  type DnsChangeLine,
  type DnsChangeView,
  type DnsRecordSet,
  type DnsZoneView,
  describeDnsChange,
  dnsRecordTypes,
  qualifyDnsName,
  type Rrset,
  RrsetSchema,
} from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Dialog, MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/dns`;
const key = (r: { name: string; type: string }) => `${r.name.toLowerCase()} ${r.type}`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

function useDnsQuery<T>(projectId: string, k: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['dns', profileId, projectId, ...k],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

// ---- Zones ---------------------------------------------------------------------------------

const TABS = [
  { key: 'zones', label: 'Zones' },
  { key: 'policies', label: 'Server policies' },
  { key: 'responsepolicies', label: 'Response policies' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function CreateZoneDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [v, setV] = useState<CreateDnsZone>({ name: '', dnsName: '', description: '', visibility: 'public', networks: [], dnssec: false });
  const [networks, setNetworks] = useState('default');
  const client = useQueryClient();
  const navigate = useNavigate();
  const profileId = useSession((s) => s.profileId);
  useEffect(() => {
    if (open) setV({ name: '', dnsName: '', description: '', visibility: 'public', networks: [], dnssec: false });
  }, [open]);
  const dnsName = v.dnsName && !v.dnsName.endsWith('.') ? `${v.dnsName}.` : v.dnsName;
  const create = useMutation({
    mutationFn: () =>
      api<DnsZoneView>(`${base(projectId)}/zones`, {
        body: {
          ...v,
          dnsName,
          networks:
            v.visibility === 'private'
              ? networks
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
        },
      }),
    onSuccess: (z) => {
      toast.success(`Created zone ${z.name}`);
      void client.invalidateQueries({ queryKey: ['dns', profileId, projectId] });
      onOpenChange(false);
      void navigate({ to: `/p/${projectId}/dns/${z.name}` });
    },
    onError: failed('Creating the zone'),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create zone"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!v.name || !dnsName}
            disabledReason="Name the zone and its domain"
            onClick={() => create.mutate()}
          >
            Create zone
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Zone name" help="Lowercase letters, digits and hyphens. Not the domain.">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} mono />
        </Field>
        <Field label="DNS name" help="The domain the zone serves, such as example.com.">
          <Input value={v.dnsName} onChange={(e) => setV({ ...v, dnsName: e.target.value })} mono />
        </Field>
        <Field label="Visibility">
          <Select<'public' | 'private'>
            value={v.visibility}
            onValueChange={(visibility) => setV({ ...v, visibility })}
            options={[
              { value: 'public', label: 'Public: answered on the internet' },
              { value: 'private', label: 'Private: answered inside VPC networks' },
            ]}
          />
        </Field>
        {v.visibility === 'private' ? (
          <Field label="Networks" help="Comma-separated VPC network names that see the zone.">
            <Input value={networks} onChange={(e) => setNetworks(e.target.value)} mono />
          </Field>
        ) : (
          <Switch
            label="DNSSEC"
            description="Signs the zone. Add the DS record at your registrar afterwards."
            checked={v.dnssec}
            onCheckedChange={(dnssec) => setV({ ...v, dnssec })}
          />
        )}
        <Field label="Description">
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <EquivalentCommand
          gcloud={`gcloud dns managed-zones create ${v.name || 'ZONE'} --dns-name=${dnsName || 'example.com.'} --visibility=${v.visibility} --description="${v.description}" --project=${projectId}`}
        />
      </div>
    </Dialog>
  );
}

/** Cloud DNS zones and the L1 policy lists (SPEC-0008 D-10). */
export function DnsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'zones',
    TABS.map((t) => t.key),
  );
  const zones = useDnsQuery<DnsZoneView[]>(projectId, ['zones'], `${base(projectId)}/zones`, tab === 'zones');
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = 'Cloud DNS · Nephoscope';
  }, []);
  const columns: ResourceColumn<DnsZoneView>[] = [
    {
      id: 'name',
      header: 'Zone',
      hideable: false,
      sortValue: (z) => z.name,
      cell: (z) => (
        <Link to={`/p/${projectId}/dns/${z.name}` as string} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {z.name}
        </Link>
      ),
    },
    { id: 'dns', header: 'DNS name', sortValue: (z) => z.dnsName, cell: (z) => <Mono value={z.dnsName} /> },
    { id: 'visibility', header: 'Visibility', width: '7rem', cell: (z) => z.visibility },
    { id: 'dnssec', header: 'DNSSEC', width: '6rem', cell: (z) => z.dnssec ?? 'off' },
    { id: 'networks', header: 'Networks', cell: (z) => z.networks.join(', ') },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (z) => z.createTime ?? '',
      cell: (z) => <Timestamp iso={z.createTime} />,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud DNS"
        subtitle="Zones and their records. Record changes are applied as one change set, shown before it is applied."
      />
      <TabNav label="Cloud DNS sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
      {tab === 'zones' ? (
        <div className="pt-3">
          {zones.isPending ? (
            <DelayedSkeleton />
          ) : zones.error instanceof ApiError ? (
            <ProblemState problem={zones.error.problem} onRetry={() => void zones.refetch()} />
          ) : (
            <ResourceTable
              tableId="dns-zones"
              label="Zones"
              rows={zones.data ?? []}
              columns={columns}
              getRowId={(z) => z.name}
              onOpen={(z) => void navigate({ to: `/p/${projectId}/dns/${z.name}` })}
              emptyTitle="No zones"
              emptyText="A managed zone holds the records of a domain, public or private."
              toolbar={
                <div className="flex justify-end">
                  <Button
                    variant="commit"
                    icon={PlusIcon}
                    disabled={!!readOnly}
                    disabledReason={readOnly}
                    onClick={() => setCreating(true)}
                  >
                    Create zone
                  </Button>
                </div>
              }
            />
          )}
        </div>
      ) : null}
      {tab === 'policies' ? <KitTable projectId={projectId} collectionKey="dns/policies" readOnly={readOnly} /> : null}
      {tab === 'responsepolicies' ? <KitTable projectId={projectId} collectionKey="dns/responsepolicies" readOnly={readOnly} /> : null}
      <CreateZoneDialog projectId={projectId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// ---- Records and change sets ---------------------------------------------------------------

const DATA_HELP: Record<string, string> = {
  A: 'IPv4 addresses, one per line.',
  AAAA: 'IPv6 addresses, one per line.',
  CNAME: 'One fully qualified name, such as app.example.com.',
  MX: 'Priority and server, one per line: 10 mail.example.com.',
  TXT: 'One string per line, in quotes: "v=spf1 -all"',
  SRV: 'Priority, weight, port and target: 10 5 5060 sip.example.com.',
  CAA: 'Flags, tag and value: 0 issue "letsencrypt.org"',
  NS: 'Name servers, one per line, ending with a dot.',
  PTR: 'One fully qualified name.',
};

interface Staged {
  additions: Rrset[];
  deletions: Rrset[];
}

const asRrset = (r: DnsRecordSet): Rrset => ({ name: r.name, type: r.type as Rrset['type'], ttl: r.ttl, rrdatas: r.rrdatas });

function RecordDialog({
  zone,
  record,
  open,
  onOpenChange,
  onStage,
}: {
  zone: DnsZoneView;
  record: DnsRecordSet | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStage: (r: Rrset) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('A');
  const [ttl, setTtl] = useState('300');
  const [data, setData] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const rel = record ? (record.name === zone.dnsName ? '@' : record.name.slice(0, -(zone.dnsName.length + 1))) : '';
    setName(rel);
    setType(record?.type ?? 'A');
    setTtl(String(record?.ttl ?? 300));
    setData(record?.rrdatas.join('\n') ?? '');
    setError(null);
  }, [open, record, zone.dnsName]);
  const fqdn = qualifyDnsName(name, zone.dnsName);
  function stage() {
    const parsed = RrsetSchema.safeParse({
      name: fqdn,
      type,
      ttl: Number(ttl),
      rrdatas: data
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'record'}: ${i.message}`).join('; '));
      return;
    }
    const inside = fqdn.toLowerCase() === zone.dnsName.toLowerCase() || fqdn.toLowerCase().endsWith(`.${zone.dnsName.toLowerCase()}`);
    if (!inside) {
      setError(`${fqdn} is not inside ${zone.dnsName}.`);
      return;
    }
    onStage(parsed.data);
    onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.type} ${record.name}` : 'Add record set'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="commit" onClick={stage}>
            Add to change set
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-dense text-ink-2">Nothing changes until the change set is applied.</p>
        <Field label="Name" help={`Relative to ${zone.dnsName}; @ is the zone itself. Full name: ${fqdn}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} mono disabled={!!record} />
        </Field>
        <Field label="Type">
          <Select<string>
            value={type}
            onValueChange={setType}
            options={dnsRecordTypes.map((t) => ({ value: t, label: t }))}
            disabled={!!record}
          />
        </Field>
        <Field label="TTL (seconds)">
          <Input value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" mono />
        </Field>
        <Field label="Data" help={DATA_HELP[type]}>
          <Textarea value={data} onChange={(e) => setData(e.target.value)} rows={5} mono spellCheck={false} />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-dense text-redline-ink">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** The gcloud commands that apply the same change set (SPEC-0001 CA-65). */
export function changeCommands(zone: string, projectId: string, lines: DnsChangeLine[]): string {
  return lines
    .map((l) => {
      const data = l.after ? ` --ttl=${l.after.ttl} --rrdatas=${quote(l.after.rrdatas.join(','))}` : '';
      const verb = l.kind === 'add' ? 'create' : l.kind === 'change' ? 'update' : 'delete';
      return `gcloud dns record-sets ${verb} ${l.name} --type=${l.type}${data} --zone=${zone} --project=${projectId}`;
    })
    .join('\n');
}

function ChangeLines({ lines, onUndo }: { lines: DnsChangeLine[]; onUndo?: (l: DnsChangeLine) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Changes">
      {lines.map((l) => (
        <li key={`${l.kind} ${l.name} ${l.type}`} className="flex items-start gap-3 rounded-control border border-rule px-3 py-2">
          <span className="w-16 shrink-0 text-meta font-medium text-ink-2">
            {l.kind === 'add' ? 'Add' : l.kind === 'remove' ? 'Remove' : 'Change'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-[12px]">
            <span className="text-ink">
              {l.type} {l.name}
            </span>
            {l.before ? (
              <span className="text-ink-2">
                <span className="sr-only">Before: </span>− {l.before.ttl}s {l.before.rrdatas.join(' | ')}
              </span>
            ) : null}
            {l.after ? (
              <span className="text-ink">
                <span className="sr-only">After: </span>+ {l.after.ttl}s {l.after.rrdatas.join(' | ')}
              </span>
            ) : null}
          </span>
          {onUndo ? (
            <Button size="sm" variant="ghost" onClick={() => onUndo(l)}>
              Undo
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One zone: record sets edited through a staged change set, its change history, and details (SPEC-0008 D-10). */
export function DnsZonePage() {
  const { projectId, zone: zoneName } = useParams({ strict: false }) as { projectId: string; zone: string };
  const zone = useDnsQuery<DnsZoneView>(projectId, ['zone', zoneName], `${base(projectId)}/zones/${enc(zoneName)}`);
  const records = useDnsQuery<DnsRecordSet[]>(projectId, ['records', zoneName], `${base(projectId)}/zones/${enc(zoneName)}/records`);
  const history = useDnsQuery<DnsChangeView[]>(projectId, ['changes', zoneName], `${base(projectId)}/zones/${enc(zoneName)}/changes`);
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const [staged, setStaged] = useState<Staged>({ additions: [], deletions: [] });
  const [editing, setEditing] = useState<{ record: DnsRecordSet | null } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const lines = useMemo(() => describeDnsChange(staged), [staged]);
  const current = useMemo(() => new Map((records.data ?? []).map((r) => [key(r), r])), [records.data]);

  // A pending change is followed until Cloud DNS reports it done, then the records are read again.
  const change = useDnsQuery<DnsChangeView>(
    projectId,
    ['change', zoneName, pending],
    `${base(projectId)}/zones/${enc(zoneName)}/changes/${pending ?? ''}`,
    !!pending,
  );
  useEffect(() => {
    if (!pending) return;
    if (change.data?.status === 'done') {
      setPending(null);
      void client.invalidateQueries({ queryKey: ['dns', profileId, projectId] });
      return;
    }
    const t = setTimeout(() => void change.refetch(), 1500);
    return () => clearTimeout(t);
  }, [pending, change.data, change.refetch, client, profileId, projectId]);

  const apply = useMutation({
    mutationFn: () => api<DnsChangeView>(`${base(projectId)}/zones/${enc(zoneName)}/changes`, { body: staged }),
    onSuccess: (c) => {
      toast.success(`Applied ${lines.length} change${lines.length === 1 ? '' : 's'}`, {
        description: c.status === 'done' ? undefined : 'Cloud DNS is applying them.',
      });
      setStaged({ additions: [], deletions: [] });
      setReviewing(false);
      setPending(c.status === 'done' ? null : c.id);
      void client.invalidateQueries({ queryKey: ['dns', profileId, projectId] });
    },
    onError: failed('Applying the change set'),
  });

  function stage(r: Rrset) {
    setStaged((s) => {
      const k = key(r);
      const existing = current.get(k);
      const deletions = existing && !s.deletions.some((d) => key(d) === k) ? [...s.deletions, asRrset(existing)] : s.deletions;
      return { deletions, additions: [...s.additions.filter((a) => key(a) !== k), r] };
    });
  }
  function stageDelete(r: DnsRecordSet) {
    setStaged((s) => ({
      additions: s.additions.filter((a) => key(a) !== key(r)),
      deletions: s.deletions.some((d) => key(d) === key(r)) ? s.deletions : [...s.deletions, asRrset(r)],
    }));
  }
  function undo(l: DnsChangeLine) {
    setStaged((s) => ({
      additions: s.additions.filter((a) => key(a) !== key(l)),
      deletions: s.deletions.filter((d) => key(d) !== key(l)),
    }));
  }

  if (zone.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (zone.error instanceof ApiError || !zone.data)
    return zone.error instanceof ApiError ? <ProblemState problem={zone.error.problem} onRetry={() => void zone.refetch()} /> : null;
  const z = zone.data;
  const stagedKeys = new Set([...staged.additions, ...staged.deletions].map(key));
  const columns: ResourceColumn<DnsRecordSet>[] = [
    { id: 'name', header: 'Name', hideable: false, sortValue: (r) => r.name, cell: (r) => <Mono value={r.name} /> },
    { id: 'type', header: 'Type', width: '6rem', sortValue: (r) => r.type, cell: (r) => r.type },
    { id: 'ttl', header: 'TTL', width: '6rem', align: 'right', sortValue: (r) => r.ttl, cell: (r) => r.ttl },
    {
      id: 'data',
      header: 'Data',
      cell: (r) => (
        <span className="flex flex-col font-mono text-[12px] break-all">
          {r.routingPolicy ? <span className="text-ink-2">{r.routingPolicy}</span> : r.rrdatas.map((d) => <span key={d}>{d}</span>)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '11rem',
      hideable: false,
      cell: (r) => {
        const fixed =
          r.type === 'SOA' ? 'SOA records are read-only' : r.routingPolicy ? 'Records with a routing policy are edited with gcloud' : null;
        const reason =
          readOnly ?? fixed ?? (!(dnsRecordTypes as readonly string[]).includes(r.type) ? `${r.type} records are not edited here` : null);
        return stagedKeys.has(key(r)) ? (
          <span className="text-meta text-ink-2">In the change set</span>
        ) : (
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={!!reason} disabledReason={reason} onClick={() => setEditing({ record: r })}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={!!reason} disabledReason={reason} onClick={() => stageDelete(r)}>
              Delete
            </Button>
          </span>
        );
      },
    },
  ];
  const historyColumns: ResourceColumn<DnsChangeView>[] = [
    { id: 'id', header: 'Change', width: '6rem', sortValue: (c) => Number(c.id), cell: (c) => c.id },
    { id: 'status', header: 'Status', width: '6rem', cell: (c) => c.status },
    { id: 'started', header: 'Started', width: '9rem', sortValue: (c) => c.startTime ?? '', cell: (c) => <Timestamp iso={c.startTime} /> },
    {
      id: 'what',
      header: 'Changes',
      cell: (c) => (
        <span className="font-mono text-[12px] break-all">
          {[...c.additions.map((r) => `+ ${r.type} ${r.name}`), ...c.deletions.map((r) => `− ${r.type} ${r.name}`)].join(', ')}
        </span>
      ),
    },
  ];
  return (
    <>
      <DetailLayout<'records' | 'history' | 'details'>
        crumbs={[{ label: 'Cloud DNS', to: `/p/${projectId}/dns` }, { label: z.name }]}
        title={z.name}
        subtitle={<Mono value={z.dnsName} />}
        cells={[
          { label: 'Visibility', value: z.visibility },
          { label: 'DNSSEC', value: z.dnssec ?? 'off' },
          { label: 'Record sets', value: String(records.data?.length ?? '') },
        ]}
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
            Delete zone
          </MenuItem>
        }
        tabs={[
          { key: 'records', label: 'Records' },
          { key: 'history', label: 'Change history' },
          { key: 'details', label: 'Details' },
        ]}
        defaultTab="records"
      >
        {(tab) =>
          tab === 'history' ? (
            <div className="pt-3">
              <ResourceTable
                tableId="dns-history"
                label="Change history"
                rows={history.data ?? []}
                columns={historyColumns}
                getRowId={(c) => c.id}
                emptyTitle="No changes"
              />
            </div>
          ) : tab === 'details' ? (
            <div className="py-5">
              <FactList
                facts={[
                  ['DNS name', <Mono key="d" value={z.dnsName} copy />],
                  ['Description', z.description ?? ''],
                  ['Visibility', z.visibility],
                  ['Networks', z.networks.join(', ')],
                  ['DNSSEC', z.dnssec ?? 'off'],
                  [
                    'Name servers',
                    <span key="ns" className="flex flex-col font-mono text-[12px]">
                      {z.nameServers.map((n) => (
                        <span key={n}>{n}</span>
                      ))}
                    </span>,
                  ],
                  ['Created', <Timestamp key="c" iso={z.createTime} />],
                ]}
              />
            </div>
          ) : (
            <>
              {lines.length > 0 ? (
                <Section
                  title={`Change set: ${lines.length} change${lines.length === 1 ? '' : 's'}`}
                  description="Applied together, in one transaction, when you apply them."
                  actions={
                    <span className="flex gap-2">
                      <Button onClick={() => setStaged({ additions: [], deletions: [] })}>Discard</Button>
                      <Button variant="commit" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setReviewing(true)}>
                        Review and apply
                      </Button>
                    </span>
                  }
                >
                  <div className="px-6">
                    <ChangeLines lines={lines} onUndo={undo} />
                  </div>
                </Section>
              ) : null}
              {pending ? (
                <p className="m-0 px-6 pt-3 text-meta text-ink-2" aria-live="polite">
                  Cloud DNS is applying change {pending}…
                </p>
              ) : null}
              <div className="pt-3">
                {records.isPending ? (
                  <DelayedSkeleton />
                ) : records.error instanceof ApiError ? (
                  <ProblemState problem={records.error.problem} onRetry={() => void records.refetch()} />
                ) : (
                  <ResourceTable
                    tableId="dns-records"
                    label="Record sets"
                    rows={records.data ?? []}
                    columns={columns}
                    getRowId={key}
                    emptyTitle="No record sets"
                    toolbar={
                      <div className="flex justify-end">
                        <Button
                          icon={PlusIcon}
                          disabled={!!readOnly}
                          disabledReason={readOnly}
                          onClick={() => setEditing({ record: null })}
                        >
                          Add record set
                        </Button>
                      </div>
                    }
                  />
                )}
              </div>
            </>
          )
        }
      </DetailLayout>
      <RecordDialog
        zone={z}
        record={editing?.record ?? null}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onStage={stage}
      />
      <Dialog
        open={reviewing}
        onOpenChange={(o) => !apply.isPending && setReviewing(o)}
        title={`Apply ${lines.length} change${lines.length === 1 ? '' : 's'} to ${z.name}`}
        width="lg"
        footer={
          <>
            <Button onClick={() => setReviewing(false)} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button variant="commit" loading={apply.isPending} onClick={() => apply.mutate()}>
              Apply changes
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-dense text-ink">Resolvers may keep the old answers until their TTL runs out.</p>
          <ChangeLines lines={lines} />
          <EquivalentCommand gcloud={changeCommands(z.name, projectId, lines)} />
        </div>
      </Dialog>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete zone"
        consequence="The zone stops answering. Cloud DNS deletes a zone only when it holds nothing but its SOA and NS records."
        expected={z.name}
        confirmLabel="Delete zone"
        command={`gcloud dns managed-zones delete ${z.name} --project=${projectId}`}
        onConfirm={async (confirm) => {
          await api(`${base(projectId)}/zones/${enc(z.name)}`, { method: 'DELETE', body: { confirm } });
          toast.success(`Deleted zone ${z.name}`);
          void client.invalidateQueries({ queryKey: ['dns', profileId, projectId] });
          void navigate({ to: `/p/${projectId}/dns` });
        }}
      />
    </>
  );
}
