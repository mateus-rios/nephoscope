import { Menu as BaseMenu } from '@base-ui/react/menu';
import { CaretDownIcon, GearIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { Legend } from '../design/Drafting';
import { MenuGroupLabel, MenuItem, MenuSeparator } from '../design/Overlays';
import { ProfileMark } from '../design/ProfileMark';
import { Stamp } from '../design/Status';
import { useActiveProfile } from '../state/queries';
import { useSession } from '../state/session';

/** Chooses the profile this tab acts with (SPEC-0001 CA-07, CA-59). */
export function ProfileSwitcher() {
  const { profile, profiles } = useActiveProfile();
  const setProfile = useSession((s) => s.setProfile);
  const navigate = useNavigate();

  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        render={
          <button
            type="button"
            className="flex h-full min-w-0 items-center gap-2.5 px-4 text-left hover:bg-hover"
            aria-label={profile ? `Profile ${profile.name}. Change profile` : 'Choose a profile'}
          />
        }
      >
        {profile ? (
          <ProfileMark
            seed={profile.keyId ?? profile.principal ?? profile.id}
            principal={profile.principal}
            name={profile.name}
            colorTag={profile.colorTag}
          />
        ) : null}
        <span className="flex min-w-0 flex-col">
          <Legend>Profile</Legend>
          <span className="flex min-w-0 items-center gap-1.5 text-dense text-ink">
            <span className="max-w-[16ch] truncate font-medium">{profile?.name ?? 'No profile'}</span>
            <CaretDownIcon size={12} className="shrink-0 text-ink-3" aria-hidden />
          </span>
        </span>
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner align="end" sideOffset={4} className="z-50 outline-none">
          <BaseMenu.Popup className="nb-popup w-[min(380px,calc(100vw-32px))] rounded-menu border border-rule-strong bg-sheet p-1 text-dense shadow-overlay outline-none">
            <BaseMenu.Group>
              <MenuGroupLabel>Act as</MenuGroupLabel>
              {profiles.map((p) => (
                <MenuItem
                  key={p.id}
                  onClick={() => setProfile(p.id)}
                  className="h-auto py-1.5"
                  aria-current={p.id === profile?.id || undefined}
                >
                  <ProfileMark seed={p.keyId ?? p.principal ?? p.id} principal={p.principal} name={p.name} colorTag={p.colorTag} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className={p.id === profile?.id ? 'font-semibold' : undefined}>{p.name}</span>
                      {p.readOnly ? <Stamp tone="redline">Read-only</Stamp> : null}
                    </span>
                    <span className="truncate font-mono text-[11px] text-ink-3">{p.principal ?? p.type}</span>
                  </span>
                </MenuItem>
              ))}
            </BaseMenu.Group>
            <MenuSeparator />
            <MenuItem onClick={() => void navigate({ to: '/connections' })}>
              <GearIcon size={16} className="text-ink-3" aria-hidden />
              Manage connections
            </MenuItem>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
