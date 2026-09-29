import type { AuditEntry, AuditQuery } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store.js';

const AUDIT_FILE = 'audit.jsonl';

/** Local audit trail of mutations and secret reveals (SPEC-0001 D-14, CA-51, CA-52). */
@Injectable()
export class AuditService {
  constructor(private readonly store: JsonStore) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.store.appendLine(AUDIT_FILE, JSON.stringify(entry));
  }

  async query(q: AuditQuery): Promise<AuditEntry[]> {
    const lines = await this.store.readLines(AUDIT_FILE);
    const limit = q.limit ?? 200;
    const out: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      let e: AuditEntry;
      try {
        e = JSON.parse(lines[i] ?? '') as AuditEntry;
      } catch {
        continue;
      }
      if (q.profileId && e.profileId !== q.profileId) continue;
      if (q.projectId && e.projectId !== q.projectId) continue;
      if (q.outcome && e.outcome !== q.outcome) continue;
      if (q.product && !e.verb.startsWith(`${q.product}.`)) continue;
      out.push(e);
    }
    return out;
  }
}
