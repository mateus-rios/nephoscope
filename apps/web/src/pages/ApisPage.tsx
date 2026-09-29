import type { ServiceSummary } from '@nephoscope/contracts';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../design/Button';
import { ConfirmDestructive } from '../design/ConfirmDestructive';
import { TitleBlock } from '../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../design/Feedback';
import { Input } from '../design/Form';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { StatusGlyph } from '../design/Status';
import { TabNav } from '../design/TabNav';
import { Mono } from '../design/Values';
import { ApiError } from '../lib/api';
import { useActiveProfile, useCan, useDisableService, useEnableService, useInstance, useServices } from '../state/queries';

/** APIs & Services: enabled and available services, enable and disable (SPEC-0001 CA-47). */
export function ApisPage() {
  const { projectId } = useParams({ from: '/p/$projectId' });
  const search = useSearch({ from: '/p/$projectId/apis' });
  const navigate = useNavigate({ from: '/p/$projectId/apis' });
  const tab = search.tab ?? 'enabled';
  const state = tab === 'enabled' ? 'ENABLED' : 'DISABLED';
  const services = useServices(projectId, state);
  const enabledCount = useServices(projectId, 'ENABLED');
  const enable = useEnableService(projectId);
  const disable = useDisableService(projectId);
  const can = useCan(projectId);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const [filter, setFilter] = useState('');
  const [toDisable, setToDisable] = useState<ServiceSummary | null>(null);

  const readOnly = !!instance.data?.readOnly || !!profile?.readOnly;
  const enableAllowed = can.permission('serviceusage.services.enable').allowed !== false;
  const disableAllowed = can.permission('serviceusage.services.disable').allowed !== false;

  const all = useMemo(() => services.data?.pages.flatMap((p) => p.items) ?? [], [services.data]);
  const q = filter.trim().toLowerCase();
  const rows = q ? all.filter((s) => s.title.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : all;

  const columns: ResourceColumn<ServiceSummary>[] = [
    {
      id: 'title',
      header: 'API',
      hideable: false,
      sortValue: (s) => s.title,
      cell: (s) => <span className="font-medium text-ink">{s.title}</span>,
    },
    { id: 'name', header: 'Service name', sortValue: (s) => s.name, cell: (s) => <Mono value={s.name} copy /> },
    {
      id: 'state',
      header: 'State',
      width: '9rem',
      sortValue: (s) => s.state,
      cell: (s) => (s.state === 'ENABLED' ? <StatusGlyph kind="ok" label="Enabled" /> : <StatusGlyph kind="paused" label="Disabled" />),
    },
    {
      id: 'action',
      header: 'Action',
      width: '8rem',
      hideable: false,
      cell: (s) =>
        s.state === 'ENABLED' ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={readOnly || !disableAllowed}
            disabledReason={readOnly ? 'Read-only' : 'Requires serviceusage.services.disable'}
            onClick={(e) => {
              e.stopPropagation();
              setToDisable(s);
            }}
          >
            Disable
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={readOnly || !enableAllowed || enable.isPending}
            disabledReason={readOnly ? 'Read-only' : 'Requires serviceusage.services.enable'}
            onClick={(e) => {
              e.stopPropagation();
              enable.mutate(
                { service: s.name },
                {
                  onSuccess: () => toast(`Enabling ${s.title}`, { description: 'Follow it in the operations tray.' }),
                  onError: (err) =>
                    toast.error(`Could not enable ${s.title}`, { description: err instanceof ApiError ? err.problem.detail : undefined }),
                },
              );
            }}
          >
            Enable
          </Button>
        ),
    },
  ];

  const enabledTotal = enabledCount.data?.pages.flatMap((p) => p.items).length;

  return (
    <div className="pb-16">
      <TitleBlock
        title="APIs & Services"
        subtitle="Google Cloud APIs of this project. A product needs its API enabled before Nephoscope can show it."
        cells={[
          { label: 'Project', value: <Mono value={projectId} /> },
          { label: 'Enabled', value: enabledTotal === undefined ? '' : String(enabledTotal) },
        ]}
      />
      <TabNav
        label="Service state"
        active={tab}
        onSelect={(key) => void navigate({ search: { tab: key as 'enabled' | 'available' } })}
        items={[
          { key: 'enabled', label: 'Enabled', count: enabledTotal ?? null },
          { key: 'available', label: 'Available' },
        ]}
      />
      <div className="pt-3">
        {services.isPending ? (
          <DelayedSkeleton />
        ) : services.error instanceof ApiError ? (
          <ProblemState problem={services.error.problem} onRetry={() => void services.refetch()} />
        ) : (
          <ResourceTable
            tableId="apis"
            label={tab === 'enabled' ? 'Enabled APIs' : 'Available APIs'}
            rows={rows}
            columns={columns}
            getRowId={(s) => s.name}
            filtered={!!q}
            emptyTitle={tab === 'enabled' ? 'No API is enabled' : 'No more APIs to enable'}
            emptyText={tab === 'enabled' ? 'Enable an API from the Available tab to start using a product.' : undefined}
            noMatchAction={<Button onClick={() => setFilter('')}>Clear the filter</Button>}
            hasMore={services.hasNextPage}
            loadingMore={services.isFetchingNextPage}
            onLoadMore={() => void services.fetchNextPage()}
            toolbar={
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={tab === 'available' ? 'Filter loaded APIs' : 'Filter APIs'}
                aria-label="Filter APIs"
                className="max-w-72"
              />
            }
          />
        )}
      </div>
      <ConfirmDestructive
        open={toDisable !== null}
        onOpenChange={(o) => !o && setToDisable(null)}
        title={`Disable ${toDisable?.title ?? ''}`}
        consequence="Resources that depend on this API stop working in this project until it is enabled again. Dependent APIs are not disabled."
        expected={toDisable?.name ?? ''}
        confirmLabel="Disable API"
        command={toDisable ? `gcloud services disable ${toDisable.name} --project=${projectId}` : undefined}
        onConfirm={async (confirm) => {
          if (!toDisable) return;
          await disable.mutateAsync({ service: toDisable.name, confirm });
          toast(`Disabling ${toDisable.title}`, { description: 'Follow it in the operations tray.' });
        }}
      />
    </div>
  );
}
