import { create } from 'zustand';

export type Theme = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'default' | 'comfortable';

const TAB_PROFILE_KEY = 'nephoscope.profile';
const LAST_PROFILE_KEY = 'nephoscope.lastProfile';
const THEME_KEY = 'nephoscope.theme';
const DENSITY_KEY = 'nephoscope.density';
const SIDEBAR_KEY = 'nephoscope.sidebar';

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* Storage can be full or blocked; the in-memory state still applies. */
  }
}

const session = typeof window === 'undefined' ? undefined : window.sessionStorage;
const local = typeof window === 'undefined' ? undefined : window.localStorage;

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

interface SessionState {
  /** The profile this tab acts with (SPEC-0001 CA-07). Null until known. */
  profileId: string | null;
  theme: Theme;
  density: Density;
  sidebarCollapsed: boolean;
  setProfile(id: string): void;
  clearProfile(): void;
  setTheme(theme: Theme): void;
  setDensity(density: Density): void;
  toggleSidebar(): void;
}

const initialTheme = (read(local, THEME_KEY) as Theme | null) ?? 'system';
const initialDensity = (read(local, DENSITY_KEY) as Density | null) ?? 'default';

export const useSession = create<SessionState>((set) => ({
  profileId: read(session, TAB_PROFILE_KEY) ?? read(local, LAST_PROFILE_KEY),
  theme: initialTheme,
  density: initialDensity,
  sidebarCollapsed: read(local, SIDEBAR_KEY) === '1',
  setProfile(id) {
    write(session, TAB_PROFILE_KEY, id);
    write(local, LAST_PROFILE_KEY, id);
    set({ profileId: id });
  },
  clearProfile() {
    write(session, TAB_PROFILE_KEY, null);
    set({ profileId: null });
  },
  setTheme(theme) {
    write(local, THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setDensity(density) {
    write(local, DENSITY_KEY, density);
    if (typeof document !== 'undefined') document.documentElement.dataset.density = density;
    set({ density });
  },
  toggleSidebar() {
    set((s) => {
      write(local, SIDEBAR_KEY, s.sidebarCollapsed ? '0' : '1');
      return { sidebarCollapsed: !s.sidebarCollapsed };
    });
  },
}));

/** Keeps the page in sync with the operating system theme while the choice is "system". */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useSession.getState().theme === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
