import { productGroupLabels } from '@nephoscope/contracts';
import { PlugsIcon, SidebarSimpleIcon, SwatchesIcon } from '@phosphor-icons/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { IconButton } from '../design/Button';
import { Legend } from '../design/Drafting';
import { Input } from '../design/Form';
import { Tooltip } from '../design/Tooltip';
import { cn } from '../lib/cn';
import { useCan } from '../state/queries';
import { useSession } from '../state/session';
import { availableProducts, iconFor, productPath } from './products';

interface Entry {
  id: string;
  name: string;
  to: string;
  hotkey?: string;
  service: string | null;
}

function IndexLink({ entry, collapsed, active, apiOff }: { entry: Entry; collapsed: boolean; active: boolean; apiOff: boolean }) {
  const Icon = entry.id === 'connections' ? PlugsIcon : entry.id === 'kit' ? SwatchesIcon : iconFor(entry.id);
  const link = (
    <Link
      to={entry.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-control px-2 text-dense text-ink-2 no-underline hover:bg-hover hover:text-ink',
        active && 'bg-construct-tint font-medium text-ink',
        apiOff && !active && 'text-ink-3',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon size={16} aria-hidden className="shrink-0" />
      {collapsed ? null : (
        <>
          <span className="flex-1 truncate">{entry.name}</span>
          {apiOff ? <span className={cn('legend', active && 'text-ink-2')}>API off</span> : null}
          {entry.hotkey && !apiOff ? <span className="font-mono text-[11px] text-ink-3 uppercase">{entry.hotkey}</span> : null}
        </>
      )}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={apiOff ? `${entry.name}, API disabled` : entry.name} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/**
 * The product index, like a parts list: grouped, searchable, with the `g` designator of each
 * entry; products whose API is off are dimmed (SPEC-0001 CA-44, CA-56).
 */
export function ProductIndex({ projectId }: { projectId: string | undefined }) {
  const collapsed = useSession((s) => s.sidebarCollapsed);
  const toggle = useSession((s) => s.toggleSidebar);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const can = useCan(projectId);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    if (projectId) {
      for (const p of availableProducts()) {
        const list = map.get(p.group) ?? [];
        list.push({ id: p.id, name: p.name, to: productPath(projectId, p), hotkey: p.hotkey, service: p.service });
        map.set(p.group, list);
      }
    }
    const q = filter.trim().toLowerCase();
    return [...map.entries()]
      .map(([group, entries]) => [group, entries.filter((e) => !q || e.name.toLowerCase().includes(q))] as const)
      .filter(([, entries]) => entries.length > 0);
  }, [projectId, filter]);

  const isActive = (to: string) =>
    to.split('/').length <= 3 ? pathname === to || pathname === `${to}/` : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <nav aria-label="Products" className={cn('flex min-h-0 flex-col border-r border-rule bg-panel', collapsed ? 'w-13' : 'w-60')}>
      <div className={cn('flex items-center gap-1 px-2 pt-2', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? null : (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter products"
            aria-label="Filter products"
            className="h-7 text-meta"
          />
        )}
        <IconButton icon={SidebarSimpleIcon} label={collapsed ? 'Expand the index' : 'Collapse the index'} size="sm" onClick={toggle} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map(([group, entries]) => (
          <div key={group} className="mt-4 first:mt-3">
            {collapsed ? (
              <div className="mx-2 mb-1 h-px bg-rule" />
            ) : (
              <Legend as="p" className="m-0 mb-1 px-2">
                {productGroupLabels[group as keyof typeof productGroupLabels]}
              </Legend>
            )}
            <div className="flex flex-col gap-px">
              {entries.map((e) => (
                <IndexLink key={e.id} entry={e} collapsed={collapsed} active={isActive(e.to)} apiOff={can.service(e.service) === false} />
              ))}
            </div>
          </div>
        ))}
        {!projectId ? collapsed ? null : <p className="mx-2 mt-4 text-meta text-ink-3">Choose a project to see its products.</p> : null}
      </div>
      <div className="border-t border-rule px-2 py-2">
        <IndexLink
          entry={{ id: 'connections', name: 'Connections', to: '/connections', service: null }}
          collapsed={collapsed}
          active={isActive('/connections')}
          apiOff={false}
        />
        {import.meta.env.DEV ? (
          <IndexLink
            entry={{ id: 'kit', name: 'Component kit', to: '/_kit', service: null }}
            collapsed={collapsed}
            active={isActive('/_kit')}
            apiOff={false}
          />
        ) : null}
      </div>
    </nav>
  );
}
