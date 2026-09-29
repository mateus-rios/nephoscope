import { constants } from 'node:fs';
import { access, appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../config/config.js';

export type CorruptionListener = (file: string) => void;

/**
 * Atomic JSON files in the data directory (SPEC-0001 D-15, CA-53 to CA-55). Falls back to memory
 * when the directory is not writable.
 */
@Injectable()
export class JsonStore {
  private readonly logger = new Logger('Store');
  private readonly memory = new Map<string, unknown>();
  private writable = true;
  private readonly corruptions: string[] = [];
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(@Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig) {}

  get dataDir(): string {
    return this.config.dataDir;
  }

  get isWritable(): boolean {
    return this.writable;
  }

  /** Files that failed to parse and were moved aside since startup (CA-54). */
  takeCorruptions(): string[] {
    return this.corruptions.splice(0);
  }

  async init(): Promise<void> {
    try {
      await mkdir(join(this.dataDir, 'store'), { recursive: true });
      await access(this.dataDir, constants.W_OK);
      this.writable = true;
    } catch (err) {
      this.writable = false;
      this.logger.warn({ msg: 'Data directory is not writable; running with in-memory state', dataDir: this.dataDir, error: String(err) });
    }
  }

  path(relative: string): string {
    return join(this.dataDir, relative);
  }

  async read<T>(relative: string, fallback: T): Promise<T> {
    if (!this.writable) return (this.memory.get(relative) as T | undefined) ?? fallback;
    const file = this.path(relative);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw err;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      const aside = `${file}.corrupt-${new Date().toISOString().replaceAll(':', '-')}`;
      await rename(file, aside).catch(() => undefined);
      this.corruptions.push(relative);
      this.logger.warn({ msg: 'Corrupted file moved aside; defaults loaded', file: relative, movedTo: aside });
      return fallback;
    }
  }

  /** Writes to a temporary file, then renames it over the target (CA-54). Serialized per file. */
  async write(relative: string, value: unknown): Promise<void> {
    if (!this.writable) {
      this.memory.set(relative, structuredClone(value));
      return;
    }
    const previous = this.queues.get(relative) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const file = this.path(relative);
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, file);
      });
    this.queues.set(relative, next);
    await next;
  }

  async writeBytes(relative: string, data: Buffer, mode = 0o600): Promise<void> {
    if (!this.writable) {
      this.memory.set(relative, Buffer.from(data));
      return;
    }
    const file = this.path(relative);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data, { mode });
    await rename(tmp, file);
  }

  async readBytes(relative: string): Promise<Buffer | null> {
    if (!this.writable) {
      const v = this.memory.get(relative);
      return Buffer.isBuffer(v) ? v : null;
    }
    try {
      return await readFile(this.path(relative));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(relative: string): Promise<void> {
    this.memory.delete(relative);
    if (this.writable) await rm(this.path(relative), { force: true });
  }

  /** Appends a line; rotates at `maxBytes`, keeping `keep` files (CA-51). */
  async appendLine(relative: string, line: string, maxBytes = 10 * 1024 * 1024, keep = 5): Promise<void> {
    if (!this.writable) {
      const lines = (this.memory.get(relative) as string[] | undefined) ?? [];
      lines.push(line);
      if (lines.length > 10_000) lines.splice(0, lines.length - 10_000);
      this.memory.set(relative, lines);
      return;
    }
    const file = this.path(relative);
    try {
      const s = await stat(file);
      if (s.size >= maxBytes) {
        for (let i = keep - 1; i >= 1; i--) {
          await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => undefined);
        }
        await rename(file, `${file}.1`).catch(() => undefined);
        await rm(`${file}.${keep + 1}`, { force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async readLines(relative: string): Promise<string[]> {
    if (!this.writable) return [...((this.memory.get(relative) as string[] | undefined) ?? [])];
    try {
      const raw = await readFile(this.path(relative), 'utf8');
      return raw.split('\n').filter(Boolean);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
