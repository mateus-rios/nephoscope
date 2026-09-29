import { DotsThreeIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { IconButton } from '../design/Button';
import { TitleBlock, type TitleCell } from '../design/Drafting';
import { Menu } from '../design/Overlays';
import { TabNav, type TabNavItem } from '../design/TabNav';
import { toLocation } from './href';
import { useSearchState } from './urlState';

export interface Crumb {
  label: string;
  to?: string;
}

interface DetailLayoutProps<T extends string> {
  crumbs: Crumb[];
  title: string;
  status?: ReactNode;
  /** The main actions; at most one commit (SPEC-0002 D-18). */
  actions?: ReactNode;
  /** Less frequent actions in the overflow menu. */
  menu?: ReactNode;
  cells?: TitleCell[];
  subtitle?: ReactNode;
  tabs: readonly (TabNavItem & { key: T })[];
  defaultTab: T;
  children: (tab: T) => ReactNode;
}

/** Detail pages share one layout: breadcrumb, title block, actions and tabs with URLs (SPEC-0001 CA-63). */
export function DetailLayout<T extends string>({
  crumbs,
  title,
  status,
  actions,
  menu,
  cells,
  subtitle,
  tabs,
  defaultTab,
  children,
}: DetailLayoutProps<T>) {
  const [tab, setTab] = useSearchState<T>(
    'tab',
    defaultTab,
    tabs.map((t) => t.key),
  );
  useEffect(() => {
    document.title = `${title} · Nephoscope`;
  }, [title]);
  return (
    <div className="pb-16">
      <nav aria-label="Breadcrumb" className="px-6 pt-3">
        <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-meta text-ink-3">
          {crumbs.map((c, i) => (
            <li key={`${c.to ?? ''}:${c.label}`} className="flex items-center gap-1">
              {i > 0 ? <span aria-hidden>/</span> : null}
              {c.to ? (
                <Link {...toLocation(c.to)} className="text-ink-2">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <TitleBlock
        title={title}
        status={status}
        subtitle={subtitle}
        cells={cells}
        actions={
          actions || menu ? (
            <>
              {actions}
              {menu ? (
                <Menu align="end" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
                  {menu}
                </Menu>
              ) : null}
            </>
          ) : undefined
        }
      />
      <TabNav label={`${title} sections`} active={tab} onSelect={(k) => setTab(k as T)} items={[...tabs]} />
      <div>{children(tab)}</div>
    </div>
  );
}
