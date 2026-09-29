import { type Prefs, PrefsSchema, type UpdatePrefs } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import { JsonStore } from './json-store.js';

const PREFS_FILE = 'store/prefs.json';
const RECENTS_FILE = 'store/recents.json';
const MAX_RECENT_PROJECTS = 10;

interface Recents {
  projects: Record<string, string[]>;
}

/** Preferences, pins and recent projects (SPEC-0001 CA-21, CA-53). */
@Injectable()
export class PrefsService {
  constructor(private readonly store: JsonStore) {}

  async get(): Promise<Prefs> {
    const raw = await this.store.read<unknown>(PREFS_FILE, {});
    const parsed = PrefsSchema.safeParse(raw);
    return parsed.success ? parsed.data : PrefsSchema.parse({});
  }

  async update(patch: UpdatePrefs): Promise<Prefs> {
    const next = PrefsSchema.parse({ ...(await this.get()), ...patch });
    await this.store.write(PREFS_FILE, next);
    return next;
  }

  async recentProjects(profileId: string): Promise<string[]> {
    const r = await this.store.read<Recents>(RECENTS_FILE, { projects: {} });
    return r.projects?.[profileId] ?? [];
  }

  async touchProject(profileId: string, projectId: string): Promise<string[]> {
    const r = await this.store.read<Recents>(RECENTS_FILE, { projects: {} });
    const list = [projectId, ...(r.projects?.[profileId] ?? []).filter((p) => p !== projectId)].slice(0, MAX_RECENT_PROJECTS);
    await this.store.write(RECENTS_FILE, { projects: { ...(r.projects ?? {}), [profileId]: list } });
    return list;
  }
}
