import { findProduct, products } from '@nephoscope/contracts';
import { DesktopIcon, KeyboardIcon, MagnifyingGlassIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { ProfileMark } from '../design/ProfileMark';
import { Spinner } from '../design/Status';
import { Kbd } from '../design/Values';
import { useActiveProfile, useProjectSearch, useRecentProjects, useResourceSearch } from '../state/queries';
import { useSession } from '../state/session';
import { useUi } from '../state/ui';
import { iconFor, productPath } from './products';

const groupHeading =
  '[&_[cmdk-group-heading]]:legend [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1';
const itemClass =
  'flex h-9 cursor-default items-center gap-3 rounded-control px-3 text-dense text-ink data-[selected=true]:bg-hover data-[disabled=true]:text-ink-3';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Map a Cloud Asset type to the Nephoscope product that shows it, when there is one (SPEC-0001 CA-70). */
function productForAsset(assetType: string): string | null {
  const service = assetType.split('/')[0] ?? '';
  const match = products.find((p) => p.available && p.service === service);
  return match?.id ?? null;
}

/**
 * Ctrl+K palette: navigation, resources, projects, profiles, settings. Opens and closes without
 * animation (SPEC-0001 CA-57, SPEC-0002 CA-29).
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const setShortcuts = useUi((s) => s.setShortcuts);
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId;
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const { profiles, profile } = useActiveProfile();
  const setProfile = useSession((s) => s.setProfile);
  const setTheme = useSession((s) => s.setTheme);
  const recents = useRecentProjects();
  const projectSearch = useProjectSearch(debounced, open && debounced.length > 0);
  const assets = useResourceSearch(projectId, open ? debounced : '');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = () => setOpen(false);
  const go = (to: string) => {
    close();
    void navigate({ to });
  };

  const navItems = products.filter((p) => p.available);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-overlay"
      contentClassName="fixed top-[20vh] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-dialog border border-rule-strong bg-sheet shadow-overlay"
    >
      <div className="flex items-center gap-2 border-b border-rule px-3">
        <MagnifyingGlassIcon size={16} className="text-ink-3" aria-hidden />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={projectId ? 'Jump to a product, resource, project or setting' : 'Jump to a project, page or setting'}
          className="h-12 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
        />
        {projectSearch.isFetching || assets.isFetching ? <Spinner label="Searching" /> : null}
      </div>
      <Command.List className="max-h-[min(60vh,480px)] overflow-y-auto p-1">
        <Command.Empty className="px-3 py-4 text-dense text-ink-2">Nothing matches. Try a project id or a product name.</Command.Empty>

        {projectId ? (
          <Command.Group heading="Go to" className={groupHeading}>
            {navItems.map((p) => {
              const Icon = iconFor(p.id);
              return (
                <Command.Item
                  key={p.id}
                  value={`go ${p.name} ${p.summary}`}
                  onSelect={() => go(productPath(projectId, p))}
                  className={itemClass}
                >
                  <Icon size={16} className="text-ink-3" aria-hidden />
                  <span className="flex-1">{p.name}</span>
                  {p.hotkey ? (
                    <span className="flex gap-1">
                      <Kbd>g</Kbd>
                      <Kbd>{p.hotkey}</Kbd>
                    </span>
                  ) : null}
                </Command.Item>
              );
            })}
          </Command.Group>
        ) : null}

        {projectId && (assets.data?.length ?? 0) > 0 ? (
          <Command.Group heading="Resources" className={groupHeading}>
            {assets.data?.map((a) => {
              const productId = productForAsset(a.assetType);
              const product = productId ? findProduct(productId) : undefined;
              return (
                <Command.Item
                  key={a.name}
                  value={`res ${a.displayName} ${a.assetType} ${a.name}`}
                  onSelect={() => (product && projectId ? go(productPath(projectId, product)) : close())}
                  className={itemClass}
                >
                  <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">{a.assetType}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        ) : null}

        <Command.Group heading="Projects" className={groupHeading}>
          {(query ? (projectSearch.data?.items ?? []).map((p) => p.projectId) : (recents.data ?? [])).slice(0, 8).map((id) => (
            <Command.Item key={`p-${id}`} value={`project ${id}`} onSelect={() => go(`/p/${encodeURIComponent(id)}`)} className={itemClass}>
              <span className="flex-1 font-mono text-[12px]">{id}</span>
              {id === projectId ? <span className="text-meta text-ink-3">Current</span> : null}
            </Command.Item>
          ))}
        </Command.Group>

        {profiles.length > 1 ? (
          <Command.Group heading="Act as" className={groupHeading}>
            {profiles.map((p) => (
              <Command.Item
                key={`prof-${p.id}`}
                value={`profile ${p.name} ${p.principal ?? ''}`}
                onSelect={() => {
                  setProfile(p.id);
                  close();
                }}
                className={itemClass}
              >
                <ProfileMark seed={p.keyId ?? p.principal ?? p.id} principal={p.principal} name={p.name} colorTag={p.colorTag} size={18} />
                <span className="flex-1">{p.name}</span>
                {p.id === profile?.id ? <span className="text-meta text-ink-3">Active</span> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="Settings" className={groupHeading}>
          <Command.Item
            value="theme light"
            onSelect={() => {
              setTheme('light');
              close();
            }}
            className={itemClass}
          >
            <SunIcon size={16} className="text-ink-3" aria-hidden />
            Use the light theme
          </Command.Item>
          <Command.Item
            value="theme dark blueprint"
            onSelect={() => {
              setTheme('dark');
              close();
            }}
            className={itemClass}
          >
            <MoonIcon size={16} className="text-ink-3" aria-hidden />
            Use the dark theme
          </Command.Item>
          <Command.Item
            value="theme system"
            onSelect={() => {
              setTheme('system');
              close();
            }}
            className={itemClass}
          >
            <DesktopIcon size={16} className="text-ink-3" aria-hidden />
            Follow the system theme
          </Command.Item>
          <Command.Item value="connections profiles keys" onSelect={() => go('/connections')} className={itemClass}>
            <span className="flex-1">Manage connections</span>
          </Command.Item>
          <Command.Item
            value="keyboard shortcuts help"
            onSelect={() => {
              close();
              setShortcuts(true);
            }}
            className={itemClass}
          >
            <KeyboardIcon size={16} className="text-ink-3" aria-hidden />
            <span className="flex-1">Keyboard shortcuts</span>
            <Kbd>?</Kbd>
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="flex items-center gap-4 border-t border-rule px-3 py-2 text-meta text-ink-3">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> to open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </Command.Dialog>
  );
}
