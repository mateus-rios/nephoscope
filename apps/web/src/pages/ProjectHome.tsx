import { type ProductDescriptor, productGroupLabels, productGroups, products } from '@nephoscope/contracts';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { iconFor, productPath } from '../app/products';
import { Button } from '../design/Button';
import { type Note, Notes, Section, TitleBlock } from '../design/Drafting';
import { DelayedSkeleton } from '../design/Feedback';
import { Input } from '../design/Form';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { StatusGlyph } from '../design/Status';
import { Tooltip } from '../design/Tooltip';
import { Chip, Mono, Timestamp } from '../design/Values';
import { ApiError } from '../lib/api';
import {
  useActiveProfile,
  useCan,
  useCapabilities,
  useEnableService,
  useInstance,
  useProject,
  useRefreshCapabilities,
} from '../state/queries';

type Access = 'full' | 'read' | 'partial' | 'none' | 'unknown' | 'na';

const READ_SUFFIX = /\.(list|get|getData|getIamPolicy|getSerialPortOutput|access|sourceCodeGet)$/;

function accessFor(p: ProductDescriptor, granted: (perm: string) => boolean | null): { access: Access; missing: string[] } {
  if (p.permissions.length === 0) return { access: 'na', missing: [] };
  const results = p.permissions.map((perm) => [perm, granted(perm)] as const);
  if (results.every(([, r]) => r === null)) return { access: 'unknown', missing: [] };
  const missing = results.filter(([, r]) => r === false).map(([perm]) => perm);
  const grantedPerms = results.filter(([, r]) => r === true).map(([perm]) => perm);
  if (missing.length === 0) return { access: 'full', missing };
  if (grantedPerms.length === 0) return { access: 'none', missing };
  const mutations = p.permissions.filter((perm) => !READ_SUFFIX.test(perm));
  const readsOnly = grantedPerms.every((perm) => READ_SUFFIX.test(perm));
  if (readsOnly && mutations.length > 0) return { access: 'read', missing };
  return { access: 'partial', missing };
}

const accessLabel: Record<Access, string> = {
  full: 'Can change',
  read: 'Read only',
  partial: 'Some changes',
  none: 'No access',
  unknown: 'Unknown',
  na: 'Nothing to check',
};

interface BomRow {
  product: ProductDescriptor;
  api: boolean | null;
  access: Access;
  missing: string[];
}

/**
 * The project home: a bill of materials of every product, with the API state and what this key can
 * do in each (SPEC-0001 CA-24; SPEC-0002 D-17 direction contract).
 */
export function ProjectHome() {
  const { projectId } = useParams({ from: '/p/$projectId' });
  const project = useProject(projectId);
  const caps = useCapabilities(projectId);
  const can = useCan(projectId);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const refresh = useRefreshCapabilities(projectId);
  const enable = useEnableService(projectId);
  const [filter, setFilter] = useState('');

  const rows = useMemo<BomRow[]>(() => {
    const order = new Map(productGroups.map((g, i) => [g, i]));
    return [...products]
      .sort((a, b) => (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0))
      .map((product) => {
        const { access, missing } = accessFor(product, (perm) => can.permission(perm).allowed);
        return { product, api: can.service(product.service), access, missing };
      });
  }, [can]);

  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.product.name.toLowerCase().includes(q) || r.product.summary.toLowerCase().includes(q)) : rows;

  const readOnly = !!instance.data?.readOnly || !!profile?.readOnly;
  const mayEnable = can.permission('serviceusage.services.enable').allowed !== false && !readOnly;

  const notes: Note[] = [];
  if (caps.data && !caps.data.services.known) {
    notes.push({
      id: 'services-unknown',
      tone: 'unknown',
      text: `Nephoscope could not read which APIs are enabled here (${caps.data.services.problemCode ?? 'unknown reason'}). Every product is shown as available, and a disabled API shows up when its page opens.`,
    });
  }
  if (caps.data && !caps.data.permissions.known) {
    notes.push({
      id: 'perms-unknown',
      tone: 'unknown',
      text: 'The permission check failed, so no action is greyed out in advance. Google still refuses what this key may not do.',
    });
  }
  if (readOnly) {
    notes.push({
      id: 'read-only',
      tone: 'warn',
      text: instance.data?.readOnly
        ? 'This Nephoscope instance is read-only. Every change to Google Cloud is refused.'
        : `The profile ${profile?.name ?? ''} is read-only. Every change to Google Cloud is refused while you act with it.`,
    });
  }
  const emulators = instance.data ? Object.entries(instance.data.emulators).filter(([, v]) => v) : [];
  if (emulators.length > 0) {
    notes.push({
      id: 'emulators',
      tone: 'info',
      text: `Emulators are in use for ${emulators.map(([k]) => k).join(', ')}. Those products talk to the emulator, not to Google.`,
    });
  }
  if ((caps.data?.permissions.invalid.length ?? 0) > 0) {
    notes.push({
      id: 'invalid-perms',
      tone: 'info',
      text: `Google rejected ${caps.data?.permissions.invalid.length} permission names of the catalog as unknown; they are left out of the check.`,
    });
  }

  const columns: ResourceColumn<BomRow>[] = [
    {
      id: 'product',
      header: 'Product',
      hideable: false,
      sortValue: (r) => r.product.name,
      cell: (r) => {
        const Icon = iconFor(r.product.id);
        const name = r.product.available ? (
          <Link to={productPath(projectId, r.product)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
            {r.product.name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{r.product.name}</span>
        );
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Icon size={16} className="shrink-0 text-ink-3" aria-hidden />
            {name}
            <span className="truncate text-ink-3">{r.product.summary}</span>
          </span>
        );
      },
    },
    {
      id: 'group',
      header: 'Group',
      width: '9rem',
      sortValue: (r) => productGroupLabels[r.product.group],
      cell: (r) => <span className="text-ink-2">{productGroupLabels[r.product.group]}</span>,
    },
    {
      id: 'api',
      header: 'API',
      width: '9.5rem',
      sortValue: (r) => (r.api === true ? 0 : r.api === false ? 1 : 2),
      cell: (r) =>
        r.product.service === null ? (
          <span className="text-ink-3">Not needed</span>
        ) : r.api === true ? (
          <StatusGlyph kind="ok" label="Enabled" />
        ) : r.api === false ? (
          <StatusGlyph kind="paused" label="Disabled" />
        ) : (
          <StatusGlyph kind="unknown" label="Unknown" />
        ),
    },
    {
      id: 'access',
      header: 'This key can',
      width: '9.5rem',
      sortValue: (r) => ['full', 'partial', 'read', 'none', 'unknown', 'na'].indexOf(r.access),
      cell: (r) => {
        const text = (
          <span
            className={r.access === 'none' ? 'text-redline-ink' : r.access === 'na' || r.access === 'unknown' ? 'text-ink-3' : 'text-ink'}
          >
            {accessLabel[r.access]}
          </span>
        );
        return r.missing.length > 0 ? (
          <Tooltip
            content={
              <span className="flex flex-col">
                <span>Missing:</span>
                {r.missing.slice(0, 12).map((m) => (
                  <span key={m} className="font-mono text-[11px]">
                    {m}
                  </span>
                ))}
                {r.missing.length > 12 ? <span>and {r.missing.length - 12} more</span> : null}
              </span>
            }
          >
            {text}
          </Tooltip>
        ) : (
          text
        );
      },
    },
    {
      id: 'nephoscope',
      header: 'In Nephoscope',
      width: '8rem',
      sortValue: (r) => (r.product.available ? 0 : Number(r.product.milestone.slice(1))),
      cell: (r) =>
        r.product.available ? (
          <span className="text-ink">Ready</span>
        ) : (
          <span className="text-ink-3">Milestone {r.product.milestone.slice(1)}</span>
        ),
    },
    {
      id: 'action',
      header: 'Action',
      width: '7rem',
      hideable: false,
      cell: (r) =>
        r.api === false && r.product.service ? (
          <Button
            size="sm"
            disabled={!mayEnable || enable.isPending}
            disabledReason={readOnly ? 'Read-only' : 'Requires serviceusage.services.enable'}
            onClick={(e) => {
              e.stopPropagation();
              const service = r.product.service as string;
              enable.mutate(
                { service },
                {
                  onSuccess: () => toast(`Enabling ${service}`, { description: 'Follow it in the operations tray.' }),
                  onError: (err) =>
                    toast.error(`Could not enable ${service}`, { description: err instanceof ApiError ? err.problem.detail : undefined }),
                },
              );
            }}
          >
            Enable
          </Button>
        ) : null,
    },
  ];

  const p = project.data;
  return (
    <div className="pb-16">
      <TitleBlock
        title={p?.name ?? projectId}
        status={
          p ? (
            p.state === 'ACTIVE' ? (
              <StatusGlyph kind="ok" label="Active" />
            ) : p.state === 'DELETE_REQUESTED' ? (
              <StatusGlyph kind="warn" label="Deletion requested" />
            ) : (
              <StatusGlyph kind="unknown" label="State unknown" />
            )
          ) : null
        }
        actions={
          <Button icon={ArrowsClockwiseIcon} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            Check access again
          </Button>
        }
        cells={[
          { label: 'Project id', value: <Mono value={projectId} copy />, mono: true },
          { label: 'Number', value: p?.projectNumber ?? '', mono: true },
          { label: 'Parent', value: p?.parent ? `${p.parent.type} ${p.parent.id}` : 'None' },
          { label: 'Created', value: <Timestamp iso={p?.createTime} /> },
          { label: 'Acting as', value: profile?.principal ? <Mono value={profile.principal} /> : (profile?.name ?? ''), wide: true },
          {
            label: 'Access checked',
            value: caps.data ? <Timestamp iso={caps.data.checkedAt} /> : caps.isPending ? 'Checking' : 'Not checked',
          },
          ...(p && Object.keys(p.labels).length > 0
            ? [
                {
                  label: 'Labels',
                  wide: true,
                  value: (
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(p.labels).map(([k, v]) => (
                        <Chip key={k} mono>
                          {k}={v}
                        </Chip>
                      ))}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Notes notes={notes} />
      <Section
        title="Bill of materials"
        description="Every product in the Nephoscope catalog: its API here, what this key can do in it, and whether Nephoscope has its page yet."
      >
        {caps.isPending ? (
          <DelayedSkeleton rows={10} />
        ) : (
          <ResourceTable
            tableId="project-bom"
            label="Products of this project"
            rows={visible}
            columns={columns}
            getRowId={(r) => r.product.id}
            itemColumn
            filtered={!!q}
            emptyTitle="No products"
            toolbar={
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter products"
                aria-label="Filter products"
                className="max-w-64"
              />
            }
          />
        )}
      </Section>
    </div>
  );
}
