import { findProduct, kitTopLevel } from '@nephoscope/contracts';
import { useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../../design/Drafting';
import { EmptyState } from '../../design/Feedback';
import { TabNav } from '../../design/TabNav';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';

/** The page of a product served by the resource kit (SPEC-0001 D-16, SPEC-0009 D-06). */
export function KitProductPage() {
  const { projectId, product: productId } = useParams({ strict: false }) as { projectId: string; product: string };
  const product = findProduct(productId);
  const collections = kitTopLevel(productId);
  const ids = collections.map((c) => c.key.split('/')[1] as string);
  const [tab, setTab] = useSearchState<string>('tab', ids[0] ?? '', ids);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = `${product?.name ?? 'Not found'} · Nephoscope`;
  }, [product?.name]);
  if (!product || collections.length === 0) {
    return <EmptyState title="Page not found">Nephoscope has no page for {productId}.</EmptyState>;
  }
  const active = collections.find((c) => c.key.endsWith(`/${tab}`)) ?? collections[0];
  return (
    <div className="pb-16">
      <TitleBlock title={product.name} subtitle={product.summary} />
      {collections.length > 1 ? (
        <TabNav
          label={`${product.name} resources`}
          active={tab}
          onSelect={setTab}
          items={collections.map((c) => ({ key: c.key.split('/')[1] as string, label: c.label }))}
        />
      ) : null}
      {active ? <KitTable key={active.key} projectId={projectId} collectionKey={active.key} readOnly={readOnly} /> : null}
    </div>
  );
}
