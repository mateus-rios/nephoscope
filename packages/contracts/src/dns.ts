import { z } from 'zod';

/** Cloud DNS zones and record sets, edited through change sets (SPEC-0008 D-10). */

/** Record types Nephoscope edits. SOA is read-only. */
export const dnsRecordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR'] as const;
export type DnsRecordType = (typeof dnsRecordTypes)[number];

const FQDN = /^(\*\.)?([A-Za-z0-9_]([A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)+$/;

export interface DnsZoneView {
  name: string;
  dnsName: string;
  description: string | null;
  visibility: 'public' | 'private';
  /** `on`, `off` or `transfer`; null when DNSSEC was never set. */
  dnssec: string | null;
  /** Networks that see a private zone. */
  networks: string[];
  nameServers: string[];
  createTime: string | null;
}

export interface DnsRecordSet {
  name: string;
  type: string;
  ttl: number;
  rrdatas: string[];
  /** Geolocation or weighted routing, as text; such record sets are not edited here (L1). */
  routingPolicy: string | null;
}

export const RrsetSchema = z.object({
  name: z.string().max(253).regex(FQDN, 'A fully qualified name ending with a dot'),
  type: z.enum(dnsRecordTypes),
  ttl: z.number().int().min(0).max(2_147_483_647),
  rrdatas: z.array(z.string().min(1).max(4096)).min(1).max(100),
});
export type Rrset = z.infer<typeof RrsetSchema>;

export const DnsChangeSchema = z
  .object({
    additions: z.array(RrsetSchema).max(100).default([]),
    deletions: z.array(RrsetSchema).max(100).default([]),
  })
  .refine((c) => c.additions.length + c.deletions.length > 0, 'The change set is empty.');
export type DnsChange = z.infer<typeof DnsChangeSchema>;

export interface DnsChangeView {
  id: string;
  /** `pending` or `done`. */
  status: string;
  startTime: string | null;
  additions: DnsRecordSet[];
  deletions: DnsRecordSet[];
}

export const CreateDnsZoneSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens'),
  dnsName: z.string().max(253).regex(FQDN, 'A domain ending with a dot, such as example.com.'),
  description: z.string().max(1024).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
  /** Network names, for private zones. */
  networks: z
    .array(z.string().regex(/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/))
    .max(50)
    .default([]),
  dnssec: z.boolean().default(false),
});
export type CreateDnsZone = z.infer<typeof CreateDnsZoneSchema>;

/** One line of a change set review: a record set added, removed, or replaced. */
export interface DnsChangeLine {
  kind: 'add' | 'remove' | 'change';
  name: string;
  type: string;
  before: { ttl: number; rrdatas: string[] } | null;
  after: { ttl: number; rrdatas: string[] } | null;
}

/** Pairs deletions and additions of the same name and type into replacements, for review. */
export function describeDnsChange(change: { additions: Rrset[]; deletions: Rrset[] }): DnsChangeLine[] {
  const key = (r: Rrset) => `${r.name.toLowerCase()} ${r.type}`;
  const added = new Map(change.additions.map((r) => [key(r), r]));
  const lines: DnsChangeLine[] = [];
  for (const d of change.deletions) {
    const a = added.get(key(d));
    if (a) added.delete(key(d));
    lines.push({
      kind: a ? 'change' : 'remove',
      name: d.name,
      type: d.type,
      before: { ttl: d.ttl, rrdatas: d.rrdatas },
      after: a ? { ttl: a.ttl, rrdatas: a.rrdatas } : null,
    });
  }
  for (const a of added.values())
    lines.push({ kind: 'add', name: a.name, type: a.type, before: null, after: { ttl: a.ttl, rrdatas: a.rrdatas } });
  return lines.sort((x, y) => x.name.localeCompare(y.name) || x.type.localeCompare(y.type));
}

/** A name typed relative to the zone (`www`, `@`) as the fully qualified name. */
export function qualifyDnsName(input: string, zoneDnsName: string): string {
  const t = input.trim();
  if (t === '' || t === '@') return zoneDnsName;
  if (t.endsWith('.')) return t;
  return `${t}.${zoneDnsName}`;
}
