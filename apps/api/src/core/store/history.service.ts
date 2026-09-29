import { Injectable } from '@nestjs/common';
import { JsonStore } from './json-store.js';

const FILE = 'store/arg-history.json';
const PER_KEY = 20;
const MAX_KEYS = 500;

type History = Record<string, string[]>;

/**
 * Recent arguments per resource, such as a workflow's execution arguments (SPEC-0001 CA-53,
 * SPEC-0003 D-11). Newest first, 20 per key; the least recently used keys go first.
 */
@Injectable()
export class HistoryService {
  constructor(private readonly store: JsonStore) {}

  async get(key: string): Promise<string[]> {
    const all = await this.store.read<History>(FILE, {});
    return all[key] ?? [];
  }

  async add(key: string, value: string): Promise<string[]> {
    const all = await this.store.read<History>(FILE, {});
    const list = [value, ...(all[key] ?? []).filter((v) => v !== value)].slice(0, PER_KEY);
    // Re-inserting moves the key to the end, so the oldest keys come first when trimming.
    delete all[key];
    all[key] = list;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete all[old];
    await this.store.write(FILE, all);
    return list;
  }
}
