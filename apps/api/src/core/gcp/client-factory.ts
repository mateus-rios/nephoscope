import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { GoogleAuth } from 'google-auth-library';
import { ProfilesService } from '../credentials/profiles.service.js';

interface Closable {
  close?: () => Promise<void> | void;
}

interface Entry {
  client: object;
  profileId: string;
  lastUsed: number;
}

const IDLE_MS = 15 * 60 * 1000;

/**
 * One SDK client per (profile, client key), shared by every request (SPEC-0001 §7). Clients idle
 * for 15 minutes are closed (D-23), and a profile's clients are closed when it is removed.
 */
@Injectable()
export class GcpClientFactory implements OnModuleDestroy {
  private readonly logger = new Logger('Clients');
  private readonly entries = new Map<string, Entry>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly profiles: ProfilesService) {
    this.profiles.onRemoved((id) => void this.evictProfile(id));
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  /**
   * Returns the cached client for `key`, creating it with the profile's auth on first use.
   * `key` must identify the client class and any options that change its behavior (endpoint, region).
   */
  get<T extends object>(profileId: string, key: string, create: (auth: GoogleAuth) => T): T {
    const handle = this.profiles.get(profileId);
    const cacheKey = `${handle.profile.id}::${key}`;
    const existing = this.entries.get(cacheKey);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client as T;
    }
    const client = create(handle.auth);
    this.entries.set(cacheKey, { client, profileId: handle.profile.id, lastUsed: Date.now() });
    return client;
  }

  get size(): number {
    return this.entries.size;
  }

  async sweep(now = Date.now()): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastUsed > IDLE_MS) {
        this.entries.delete(key);
        await this.close(entry.client, key);
      }
    }
  }

  async evictProfile(profileId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.profileId === profileId) {
        this.entries.delete(key);
        await this.close(entry.client, key);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    const all = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(all.map(([key, e]) => this.close(e.client, key)));
  }

  private async close(client: object, key: string): Promise<void> {
    try {
      await (client as Closable).close?.();
    } catch (err) {
      this.logger.debug({ msg: 'Client close failed', key, error: String(err) });
    }
  }
}
