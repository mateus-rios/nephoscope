import type {
  BucketIamPolicy,
  CorsRule,
  CreateBucket,
  LifecycleRule,
  StorageBucket,
  StorageObject,
  UpdateBucket,
} from '@nephoscope/contracts';

/** Cloud Storage JSON resources to DTOs and back (SPEC-0006 D-10, D-11). */

// biome-ignore lint/suspicious/noExplicitAny: JSON API resources are loosely typed at this boundary.
type Json = any;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : v === undefined || v === null || v === '' ? null : String(v);
const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

export function mapBucket(m: Json): StorageBucket {
  const retention = m.retentionPolicy?.retentionPeriod !== undefined ? m.retentionPolicy : null;
  const softDelete = num(m.softDeletePolicy?.retentionDurationSeconds);
  return {
    name: String(m.name ?? m.id),
    location: String(m.location ?? ''),
    locationType: str(m.locationType),
    storageClass: String(m.storageClass ?? 'STANDARD'),
    created: str(m.timeCreated),
    updated: str(m.updated),
    metageneration: str(m.metageneration),
    uniformAccess: !!m.iamConfiguration?.uniformBucketLevelAccess?.enabled,
    publicAccessPrevention: m.iamConfiguration?.publicAccessPrevention === 'enforced' ? 'enforced' : 'inherited',
    versioning: !!m.versioning?.enabled,
    softDeleteSeconds: softDelete ? softDelete : null,
    hierarchicalNamespace: !!m.hierarchicalNamespace?.enabled,
    autoclass: !!m.autoclass?.enabled,
    labels: { ...(m.labels ?? {}) },
    retention: retention
      ? { periodSeconds: Number(retention.retentionPeriod), locked: !!retention.isLocked, effectiveTime: str(retention.effectiveTime) }
      : null,
    requesterPays: !!m.billing?.requesterPays,
    website:
      m.website && (m.website.mainPageSuffix || m.website.notFoundPage)
        ? { mainPageSuffix: str(m.website.mainPageSuffix), notFoundPage: str(m.website.notFoundPage) }
        : null,
    defaultKmsKeyName: str(m.encryption?.defaultKmsKeyName),
    lifecycle: (m.lifecycle?.rule ?? []) as LifecycleRule[],
    cors: (m.cors ?? []) as CorsRule[],
  };
}

export function mapObject(m: Json): StorageObject {
  return {
    name: String(m.name),
    bucket: String(m.bucket ?? ''),
    generation: String(m.generation ?? ''),
    metageneration: str(m.metageneration),
    size: String(m.size ?? '0'),
    contentType: str(m.contentType),
    storageClass: str(m.storageClass),
    created: str(m.timeCreated),
    updated: str(m.updated),
    customTime: str(m.customTime),
    md5: str(m.md5Hash),
    crc32c: str(m.crc32c),
    etag: str(m.etag),
    cacheControl: str(m.cacheControl),
    contentDisposition: str(m.contentDisposition),
    contentEncoding: str(m.contentEncoding),
    contentLanguage: str(m.contentLanguage),
    metadata: Object.fromEntries(Object.entries(m.metadata ?? {}).map(([k, v]) => [k, String(v)])),
    eventBasedHold: !!m.eventBasedHold,
    temporaryHold: !!m.temporaryHold,
    retentionExpirationTime: str(m.retentionExpirationTime),
    kmsKeyName: str(m.kmsKeyName),
    timeDeleted: str(m.timeDeleted),
    softDeleteTime: str(m.softDeleteTime),
    hardDeleteTime: str(m.hardDeleteTime),
  };
}

/** Create options in the SDK's createBucket shape. */
export function createOptions(b: CreateBucket): Json {
  return {
    location: b.location,
    storageClass: b.storageClass ?? 'STANDARD',
    ...(b.autoclass ? { autoclass: { enabled: true } } : {}),
    ...(b.hierarchicalNamespace ? { hierarchicalNamespace: { enabled: true } } : {}),
    iamConfiguration: {
      uniformBucketLevelAccess: { enabled: b.uniformAccess ?? true },
      publicAccessPrevention: (b.publicAccessPrevention ?? true) ? 'enforced' : 'inherited',
    },
    softDeletePolicy: { retentionDurationSeconds: String(b.softDeleteSeconds === null ? 0 : (b.softDeleteSeconds ?? 7 * 86_400)) },
    versioning: { enabled: !!b.versioning },
    ...(b.retentionSeconds ? { retentionPolicy: { retentionPeriod: String(b.retentionSeconds) } } : {}),
    labels: b.labels ?? {},
  };
}

/** A metadata patch for setMetadata, with only the settings the form changed. */
export function updatePatch(u: UpdateBucket, current: StorageBucket): Json {
  const patch: Json = {};
  if (u.storageClass) patch.storageClass = u.storageClass;
  if (u.versioning !== undefined) patch.versioning = { enabled: u.versioning };
  if (u.softDeleteSeconds !== undefined) patch.softDeletePolicy = { retentionDurationSeconds: String(u.softDeleteSeconds ?? 0) };
  if (u.publicAccessPrevention !== undefined || u.uniformAccess !== undefined) {
    patch.iamConfiguration = {
      ...(u.uniformAccess !== undefined ? { uniformBucketLevelAccess: { enabled: u.uniformAccess } } : {}),
      ...(u.publicAccessPrevention !== undefined ? { publicAccessPrevention: u.publicAccessPrevention ? 'enforced' : 'inherited' } : {}),
    };
  }
  if (u.labels) {
    // Labels merge in a patch; removed keys are sent as null so they are dropped.
    const next: Record<string, string | null> = { ...u.labels };
    for (const k of Object.keys(current.labels)) if (!(k in u.labels)) next[k] = null;
    patch.labels = next;
  }
  if (u.requesterPays !== undefined) patch.billing = { requesterPays: u.requesterPays };
  if (u.website !== undefined)
    patch.website = u.website ? { mainPageSuffix: u.website.mainPageSuffix || null, notFoundPage: u.website.notFoundPage || null } : null;
  if (u.defaultKmsKeyName !== undefined) patch.encryption = u.defaultKmsKeyName ? { defaultKmsKeyName: u.defaultKmsKeyName } : null;
  if (u.lifecycle) patch.lifecycle = { rule: u.lifecycle };
  if (u.cors) patch.cors = u.cors;
  if (u.retentionSeconds !== undefined) patch.retentionPolicy = u.retentionSeconds ? { retentionPeriod: String(u.retentionSeconds) } : null;
  return patch;
}

export function mapPolicy(p: Json): BucketIamPolicy {
  return {
    etag: str(p.etag),
    version: Number(p.version ?? 1),
    bindings: (p.bindings ?? []).map((b: Json) => ({
      role: String(b.role),
      members: [...(b.members ?? [])].map(String),
      condition: b.condition ? { title: String(b.condition.title ?? ''), expression: String(b.condition.expression ?? '') } : null,
    })),
  };
}

/** Content-Disposition with the file name in both forms (RFC 6266). */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const base = name.split('/').pop() || 'download';
  const ascii = base.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

/** Parses a single-range "bytes=" header against a size; null means the whole object. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
