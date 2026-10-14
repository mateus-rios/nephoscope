import {
  fillKitTemplate,
  findKitCollection,
  findProduct,
  type KitAction,
  type KitCollection,
  type KitItem,
  kitCollections,
  kitTopLevel,
  kitWhen,
  readPath,
} from '@nephoscope/contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { type Crumb, DetailLayout } from '../../kit/DetailLayout';
import { FactList } from '../../kit/FactList';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { KitActionDialog } from '../../kit/resource/KitActionDialog';
import { KitTable } from '../../kit/resource/KitTable';
import { humanize, KitValue, kitTitle, stateKind } from '../../kit/resource/KitValue';
import { kitHref, useKitExtra, useKitItem } from '../../kit/resource/kitApi';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { kitTabs } from './tabs';

/** The parent of a child collection item: its collection and path, when the path shows it. */
function parentOf(collection: KitCollection, path: string): { collection: KitCollection; path: string } | null {
  const parent = kitCollections.find((c) => c.children?.includes(collection.key));
  if (!parent) return null;
  const parentPath = path.split('/').slice(0, -2).join('/');
  return new RegExp(parent.pathPattern).test(parentPath) ? { collection: parent, path: parentPath } : null;
}

function crumbsFor(projectId: string, collection: KitCollection, path: string): Crumb[] {
  const chain: Crumb[] = [];
  let cur = parentOf(collection, path);
  while (cur) {
    chain.unshift({ label: cur.path.split('/').pop() ?? cur.path, to: kitHref(projectId, cur.collection.key, cur.path) });
    cur = parentOf(cur.collection, cur.path);
  }
  const top = chain.length > 0 ? null : collection;
  const product = findProduct(collection.product);
  const tab = top && kitTopLevel(collection.product).length > 1 ? `?tab=${top.key.split('/')[1]}` : '';
  return [{ label: product?.name ?? collection.product, to: `/p/${projectId}/${collection.product}${tab}` }, ...chain];
}

function visible(action: KitAction, item: KitItem): boolean {
  return (action.scope ?? 'item') === 'item' && kitWhen(action.when, item);
}

function Extra({
  projectId,
  collectionKey,
  path,
  extra,
}: {
  projectId: string;
  collectionKey: string;
  path: string;
  extra: { id: string; label: string; render: string };
}) {
  const q = useKitExtra(projectId, collectionKey, path, extra.id, true);
  if (q.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (q.error instanceof ApiError) return <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />;
  const value = q.data?.value;
  if (extra.render === 'json') return <RawView value={value} fileName={`${path.split('/').pop()}-${extra.id}`} />;
  if (extra.render === 'image') {
    return typeof value === 'string' && value ? (
      <div className="px-6 py-4">
        <img src={`data:image/png;base64,${value}`} alt={extra.label} className="max-w-full border border-rule" />
      </div>
    ) : (
      <EmptyState title={`No ${extra.label.toLowerCase()}`}>Google returned no image.</EmptyState>
    );
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="px-6 py-4">
      <CodeEditor value={text} language={extra.render === 'sql' ? 'sql' : 'plaintext'} readOnly height="60vh" label={extra.label} />
    </div>
  );
}

/** A resource served by the resource kit: facts, children, logs, raw JSON and actions (SPEC-0001 D-16). */
export function KitItemPage() {
  const params = useParams({ strict: false }) as { projectId: string; product: string; collection: string; _splat?: string };
  const { projectId } = params;
  const key = `${params.product}/${params.collection}`;
  const path = (params._splat ?? '').replace(/^\/+|\/+$/g, '');
  const collection = findKitCollection(key);
  const query = useKitItem(projectId, key, path);
  const navigate = useNavigate();
  const [acting, setActing] = useState<KitAction | null>(null);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);

  if (!collection || !new RegExp(collection.pathPattern).test(path)) {
    return <EmptyState title="Page not found">This address does not name a resource Nephoscope shows.</EmptyState>;
  }
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !query.data)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;

  const item = query.data;
  const title = kitTitle(collection.titlePath, item);
  const facts = collection.facts ?? collection.columns;
  const stateValue = collection.state ? String(readPath(item, collection.state.path) ?? '') : '';
  const actions = (collection.actions ?? []).filter((a) => visible(a, item));
  const children = (collection.children ?? []).map((k) => findKitCollection(k)).filter((c): c is KitCollection => !!c);
  const logFilter = collection.logFilter ? fillKitTemplate(collection.logFilter, { project: projectId, item }) : null;
  const extras = (collection.extras ?? []).filter((e) => !e.hidden && kitWhen(e.when, item));
  const metricLabels = collection.metrics
    ? Object.fromEntries(Object.entries(collection.metrics.labels).map(([k, v]) => [k, fillKitTemplate(v, { project: projectId, item })]))
    : null;
  const custom = (collection.customTabs ?? []).filter((t) => kitTabs[t.id]);
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...children.map((c) => ({ key: `c-${c.key.split('/')[1]}`, label: c.label })),
    ...custom.map((t) => ({ key: `t-${t.id}`, label: t.label })),
    ...extras.map((e) => ({ key: `x-${e.id}`, label: e.label })),
    ...(metricLabels ? [{ key: 'metrics', label: 'Metrics' }] : []),
    ...(logFilter ? [{ key: 'logs', label: 'Logs' }] : []),
    { key: 'json', label: 'JSON' },
  ];
  const primary = actions.filter((a) => !a.danger).slice(0, 2);
  const overflow = actions.filter((a) => !primary.includes(a));

  return (
    <>
      <DetailLayout<string>
        crumbs={[...crumbsFor(projectId, collection, path), { label: title }]}
        title={title}
        status={stateValue ? <StatusGlyph kind={stateKind(collection.state, stateValue)} label={humanize(stateValue)} /> : undefined}
        subtitle={collection.singular.charAt(0).toUpperCase() + collection.singular.slice(1)}
        actions={
          primary.length > 0
            ? primary.map((a) => (
                <Button key={a.id} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setActing(a)}>
                  {a.label}
                </Button>
              ))
            : undefined
        }
        menu={
          overflow.length > 0
            ? overflow.map((a) => (
                <MenuItem
                  key={a.id}
                  onClick={() => setActing(a)}
                  disabled={!!readOnly}
                  className={a.danger ? 'text-redline-ink' : undefined}
                >
                  {a.label}
                </MenuItem>
              ))
            : undefined
        }
        cells={facts
          .filter((f) => f.kind !== 'state' && f.kind !== 'labels')
          .slice(0, 4)
          .map((f) => ({ label: f.header, value: <KitValue column={f} item={item} state={collection.state} />, mono: f.kind === 'mono' }))}
        tabs={tabs}
        defaultTab="overview"
      >
        {(tab) => {
          if (tab === 'overview') {
            return (
              <div className="py-5">
                <FactList
                  facts={[
                    [
                      'Name',
                      <span key="n" className="font-mono text-[12px] break-all">
                        {String(item.name ?? item.selfLink ?? item._path)}
                      </span>,
                    ],
                    ...facts.map((f): [string, React.ReactNode] => [
                      f.header,
                      <KitValue key={f.id} column={f} item={item} state={collection.state} />,
                    ]),
                  ]}
                />
              </div>
            );
          }
          if (tab === 'logs' && logFilter) return <LogsPanel projectId={projectId} filter={logFilter} />;
          if (tab === 'metrics' && collection.metrics && metricLabels)
            return <MetricsPanel projectId={projectId} kind={collection.metrics.kind} labels={metricLabels} />;
          if (tab === 'json') return <RawView value={stripKit(item)} fileName={title} />;
          if (tab.startsWith('c-')) {
            const child = children.find((c) => c.key.endsWith(`/${tab.slice(2)}`));
            return child ? (
              <KitTable key={child.key} projectId={projectId} collectionKey={child.key} parent={path} readOnly={readOnly} />
            ) : null;
          }
          if (tab.startsWith('t-')) {
            const Tab = kitTabs[tab.slice(2)];
            return Tab ? <Tab projectId={projectId} collectionKey={key} path={path} item={item} readOnly={readOnly} /> : null;
          }
          if (tab.startsWith('x-')) {
            const extra = extras.find((e) => e.id === tab.slice(2));
            return extra ? <Extra projectId={projectId} collectionKey={key} path={path} extra={extra} /> : null;
          }
          return null;
        }}
      </DetailLayout>
      <KitActionDialog
        projectId={projectId}
        collectionKey={key}
        action={acting}
        item={item}
        onOpenChange={(o) => !o && setActing(null)}
        onDone={() => {
          if (acting?.id === 'delete') void navigate({ to: crumbsFor(projectId, collection, path).at(-1)?.to ?? `/p/${projectId}` });
        }}
      />
    </>
  );
}

/** The resource as Google returned it, without the kit's own fields. */
/** The item as Google returned it: without the kit's `_` fields. */
function stripKit(item: KitItem): unknown {
  return Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));
}
