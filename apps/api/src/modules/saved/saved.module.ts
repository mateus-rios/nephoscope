import { randomUUID } from 'node:crypto';
import { type SavedItem, type SavedKind, type SaveItem, SaveItemSchema, savedKinds } from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { JsonStore } from '../../core/store/json-store.js';

const FILE = 'store/saved-queries.json';
const PER_KIND = 200;

type Saved = Partial<Record<SavedKind, SavedItem[]>>;

/** Saved queries and charts, local to this Nephoscope (SPEC-0001 CA-53). */
@Injectable()
export class SavedService {
  constructor(private readonly store: JsonStore) {}

  async list(kind: SavedKind, projectId?: string): Promise<SavedItem[]> {
    const all = await this.store.read<Saved>(FILE, {});
    return (all[kind] ?? []).filter((s) => !projectId || s.projectId === null || s.projectId === projectId);
  }

  async add(kind: SavedKind, item: SaveItem): Promise<SavedItem> {
    const all = await this.store.read<Saved>(FILE, {});
    const saved: SavedItem = {
      id: randomUUID(),
      name: item.name,
      value: item.value,
      projectId: item.projectId,
      createdAt: new Date().toISOString(),
    };
    // A save under an existing name replaces it, so the list reads like a set of named queries.
    const rest = (all[kind] ?? []).filter((s) => !(s.name === item.name && s.projectId === item.projectId));
    all[kind] = [saved, ...rest].slice(0, PER_KIND);
    await this.store.write(FILE, all);
    return saved;
  }

  async remove(kind: SavedKind, id: string): Promise<void> {
    const all = await this.store.read<Saved>(FILE, {});
    all[kind] = (all[kind] ?? []).filter((s) => s.id !== id);
    await this.store.write(FILE, all);
  }
}

const kind = { schema: z.enum(savedKinds) };

@Controller('api/saved')
export class SavedController {
  constructor(private readonly saved: SavedService) {}

  @Get(':kind')
  list(
    @Param('kind', kind) k: SavedKind,
    @Query({ schema: z.object({ projectId: z.string().max(100).optional() }) }) q: { projectId?: string },
  ) {
    return this.saved.list(k, q.projectId);
  }

  @Post(':kind')
  @Mutation({ product: 'nephoscope', verb: 'saved.add', scope: 'local' })
  add(@Param('kind', kind) k: SavedKind, @Body({ schema: SaveItemSchema }) body: SaveItem): Promise<SavedItem> {
    return this.saved.add(k, body);
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  @Mutation({ product: 'nephoscope', verb: 'saved.remove', scope: 'local' })
  remove(@Param('kind', kind) k: SavedKind, @Param('id', { schema: z.string().uuid() }) id: string): Promise<void> {
    return this.saved.remove(k, id);
  }
}

@Module({ controllers: [SavedController], providers: [SavedService] })
export class SavedModule {}
