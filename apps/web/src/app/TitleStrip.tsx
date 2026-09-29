import { Menu as BaseMenu } from '@base-ui/react/menu';
import { GearIcon, KeyboardIcon, MagnifyingGlassIcon, ScrollIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { IconButton } from '../design/Button';
import { MenuGroupLabel, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../design/Overlays';
import { Stamp } from '../design/Status';
import { Kbd } from '../design/Values';
import { cn } from '../lib/cn';
import { type InstanceView, useActiveProfile } from '../state/queries';
import { type Density, type Theme, useSession } from '../state/session';
import { useUi } from '../state/ui';
import { NephoscopeMark } from './NephoscopeMark';
import { OperationsTray } from './Operations';
import { ProfileSwitcher } from './ProfileSwitcher';
import { ProjectPicker } from './ProjectPicker';

const ribbon: Record<string, string> = {
  none: 'bg-rule',
  gray: 'bg-tag-gray',
  blue: 'bg-tag-blue',
  green: 'bg-tag-green',
  amber: 'bg-tag-amber',
  red: 'bg-tag-red',
  violet: 'bg-tag-violet',
};

function SettingsMenu() {
  const theme = useSession((s) => s.theme);
  const density = useSession((s) => s.density);
  const setTheme = useSession((s) => s.setTheme);
  const setDensity = useSession((s) => s.setDensity);
  const setShortcuts = useUi((s) => s.setShortcuts);
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={<IconButton icon={GearIcon} label="Settings" />} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner align="end" sideOffset={4} className="z-50 outline-none">
          <BaseMenu.Popup className="nb-popup min-w-56 rounded-menu border border-rule-strong bg-sheet p-1 text-dense shadow-overlay outline-none">
            <BaseMenu.Group>
              <MenuGroupLabel>Theme</MenuGroupLabel>
              <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                <MenuRadioItem value="system">System</MenuRadioItem>
                <MenuRadioItem value="light">Light, drafting film</MenuRadioItem>
                <MenuRadioItem value="dark">Dark, blueprint</MenuRadioItem>
              </MenuRadioGroup>
            </BaseMenu.Group>
            <MenuSeparator />
            <BaseMenu.Group>
              <MenuGroupLabel>Density</MenuGroupLabel>
              <MenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
                <MenuRadioItem value="compact">Compact</MenuRadioItem>
                <MenuRadioItem value="default">Default</MenuRadioItem>
                <MenuRadioItem value="comfortable">Comfortable</MenuRadioItem>
              </MenuRadioGroup>
            </BaseMenu.Group>
            <MenuSeparator />
            <MenuItem onClick={() => setShortcuts(true)}>
              <KeyboardIcon size={16} className="text-ink-3" aria-hidden />
              <span className="flex-1">Keyboard shortcuts</span>
              <Kbd>?</Kbd>
            </MenuItem>
            {/* Apache-2.0 and the notices of bundled software (SPEC-0001 D-28). */}
            <MenuItem onClick={() => window.open('/third-party-notices.txt', '_blank', 'noopener')}>
              <ScrollIcon size={16} className="text-ink-3" aria-hidden />
              <span className="flex-1">Open-source licenses</span>
            </MenuItem>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/**
 * The title strip: the sheet's title block across the top, with the profile ribbon beneath
 * (SPEC-0002 D-17, CA-31; SPEC-0001 CA-59).
 */
export function TitleStrip({ projectId, instance }: { projectId: string | undefined; instance: InstanceView | undefined }) {
  const { profile } = useActiveProfile();
  const setPalette = useUi((s) => s.setPalette);
  const readOnlyReason = instance?.readOnly
    ? 'This Nephoscope instance is read-only (NEPHOSCOPE_READ_ONLY).'
    : profile?.readOnly
      ? `The profile ${profile.name} is read-only.`
      : null;
  const emulators = instance ? Object.entries(instance.emulators).filter(([, host]) => host) : [];

  return (
    <header className="relative z-20 bg-panel">
      <div className="flex h-12 items-stretch border-b border-rule">
        <Link
          to="/"
          aria-label="Nephoscope home"
          className="flex items-center gap-2 border-r border-rule px-4 text-ink no-underline hover:bg-hover"
        >
          <NephoscopeMark />
          <span className="text-dense font-semibold tracking-[0.01em]">Nephoscope</span>
        </Link>
        <div className="flex min-w-0 border-r border-rule">
          <ProjectPicker projectId={projectId} />
        </div>
        <div className="flex min-w-0 flex-1 items-center px-4">
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="flex h-8 w-full max-w-md items-center gap-2 rounded-control border border-rule bg-sheet px-2.5 text-left text-dense text-ink-3 hover:border-rule-strong"
          >
            <MagnifyingGlassIcon size={14} aria-hidden />
            <span className="flex-1 truncate">Jump to a product, resource or project</span>
            <span className="hidden gap-1 sm:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>
        {readOnlyReason || emulators.length > 0 ? (
          <div className="flex items-center gap-2 border-l border-rule px-3">
            {readOnlyReason ? (
              <Stamp tone="redline" title={readOnlyReason}>
                Read-only
              </Stamp>
            ) : null}
            {emulators.length > 0 ? (
              <Stamp tone="construct" title={`Emulators in use: ${emulators.map(([k, v]) => `${k} at ${v}`).join(', ')}`}>
                Emulator
              </Stamp>
            ) : null}
          </div>
        ) : null}
        <div className="flex border-l border-rule">
          <OperationsTray />
        </div>
        <div className="flex min-w-0 border-l border-rule">
          <ProfileSwitcher />
        </div>
        <div className="flex items-center border-l border-rule px-2">
          <SettingsMenu />
        </div>
      </div>
      <div className={cn('h-0.5', ribbon[profile?.colorTag ?? 'none'])} aria-hidden />
    </header>
  );
}
