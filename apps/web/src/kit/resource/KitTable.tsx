import { findKitCollection, GCP_REGIONS, type KitAction, type KitItem } from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { ApiError } from '../../lib/api';
import { Facet, Notes, partialNote, RefreshControl, useFacet } from '../ListControls';
import { useSearchState } from '../urlState';
import { KitActionDialog } from './KitActionDialog';
import { KitValue, kitSortValue, kitTitle } from './KitValue';
import { kitHref, useKitList } from './kitApi';

interface KitTableProps {
  projectId: string;
  collectionKey: string;
  /** Parent item path, for child collections. */
  parent?: string;
  /** Read-only reason, which disables actions (SPEC-0001 CA-49). */
  readOnly: string | null;
}

/** A kit collection as a list (SPEC-0001 CA-62): filter, facets, refresh, paging, create. */
export function KitTable({ projectId, collectionKey, parent, readOnly }: KitTableProps) {
  const collection = findKitCollection(collectionKey);
  const prefix = parent ? `${collectionKey.split('/')[1]}.` : '';
  const [region, setRegion] = useSearchState<string>(`${prefix}region`, 'all');
  const query = useKitList(projectId, collectionKey, { parent, region: region === 'all' ? undefined : region });
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [acting, setActing] = useState<KitAction | null>(null);
  const locationFacet = useFacet(`${prefix}location`);
  const all = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data]);
  const unreachable = useMemo(() => [...new Set((query.data?.pages ?? []).flatMap((p) => p.unreachable ?? []))], [query.data]);
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (x) =>
          (locationFacet === 'all' || x._location === locationFacet) &&
          (!q || x._path.toLowerCase().includes(q) || kitTitle(collection?.titlePath, x).toLowerCase().includes(q)),
      ),
    [all, locationFacet, q, collection?.titlePath],
  );
  if (!collection) return null;
  // Rows of some child lists name resources of another collection, such as a group's instances.
  const target = collection.linkTo ?? collectionKey;
  const create = collection.actions?.find((a) => a.scope === 'collection');
  const showLocation = all.some((x) => x._location);
  const columns: ResourceColumn<KitItem>[] = [
    {
      id: 'name',
      header: collection.singular.charAt(0).toUpperCase() + collection.singular.slice(1),
      hideable: false,
      sortValue: (x) => kitTitle(collection.titlePath, x),
      cell: (x) => (
        <Link to={kitHref(projectId, target, x._path)} className="truncate font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {kitTitle(collection.titlePath, x)}
        </Link>
      ),
    },
    ...collection.columns.map(
      (c): ResourceColumn<KitItem> => ({
        id: c.id,
        header: c.header,
        width: c.width,
        defaultHidden: c.defaultHidden,
        align: c.kind === 'number' || c.kind === 'bytes' || c.kind === 'count' ? 'right' : undefined,
        sortValue: (x) => kitSortValue(c, x),
        cell: (x) => <KitValue column={c} item={x} state={collection.state} />,
      }),
    ),
  ];
  return (
    <div className="pt-3">
      <Notes notes={partialNote(unreachable)} />
      {query.isPending ? (
        <DelayedSkeleton />
      ) : query.error instanceof ApiError ? (
        <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
      ) : (
        <ResourceTable
          tableId={`kit-${collectionKey}`}
          label={collection.label}
          rows={rows}
          columns={columns}
          getRowId={(x) => x._path}
          onOpen={(x) => void navigate({ to: kitHref(projectId, target, x._path) })}
          filtered={rows.length !== all.length}
          emptyTitle={`No ${collection.label.toLowerCase()}`}
          emptyText={collection.description}
          emptyAction={
            create ? (
              <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setActing(create)}>
                {create.label}
              </Button>
            ) : undefined
          }
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name"
                aria-label={`Filter ${collection.label.toLowerCase()}`}
                className="w-64"
              />
              {collection.regional ? (
                <Field label="Region" className="w-48">
                  <Select<string>
                    value={region}
                    onValueChange={setRegion}
                    options={[{ value: 'all', label: 'All regions' }, ...GCP_REGIONS.map((r) => ({ value: r, label: r }))]}
                  />
                </Field>
              ) : null}
              {showLocation && !collection.regional ? (
                <Facet label="Location" param={`${prefix}location`} rows={all} valueFor={(x) => x._location} />
              ) : null}
              <span className="ml-auto flex items-end gap-2">
                {create && all.length > 0 ? (
                  <Button
                    variant="commit"
                    icon={PlusIcon}
                    disabled={!!readOnly}
                    disabledReason={readOnly}
                    onClick={() => setActing(create)}
                  >
                    {create.label}
                  </Button>
                ) : null}
                <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
              </span>
            </div>
          }
        />
      )}
      <KitActionDialog
        projectId={projectId}
        collectionKey={collectionKey}
        action={acting}
        item={null}
        parent={parent}
        onOpenChange={(o) => !o && setActing(null)}
      />
    </div>
  );
}
