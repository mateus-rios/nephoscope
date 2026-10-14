import {
  type Confirm,
  ConfirmSchema,
  type CreateDnsZone,
  CreateDnsZoneSchema,
  type DnsChange,
  DnsChangeSchema,
  type DnsChangeView,
  type DnsRecordSet,
  type DnsZoneView,
  ProjectIdParamSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Cloud DNS resources are read field by field.
type Any = any;

const DNS = 'https://dns.googleapis.com/dns/v1/';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function mapZone(z: Any): DnsZoneView {
  return {
    name: String(z?.name ?? ''),
    dnsName: String(z?.dnsName ?? ''),
    description: str(z?.description),
    visibility: z?.visibility === 'private' ? 'private' : 'public',
    dnssec: str(z?.dnssecConfig?.state),
    networks: ((z?.privateVisibilityConfig?.networks ?? []) as Any[]).map(
      (n) =>
        String(n?.networkUrl ?? '')
          .split('/')
          .pop() ?? '',
    ),
    nameServers: ((z?.nameServers ?? []) as Any[]).map(String),
    createTime: str(z?.creationTime),
  };
}

/** A routing policy as one line of text (L1). */
export function routingPolicyText(p: Any): string | null {
  if (!p) return null;
  if (p.geo)
    return `Geolocation: ${((p.geo.items ?? []) as Any[]).map((i) => `${i?.location} → ${((i?.rrdatas ?? []) as string[]).join(' ')}`).join('; ')}`;
  if (p.wrr)
    return `Weighted: ${((p.wrr.items ?? []) as Any[]).map((i) => `${i?.weight} → ${((i?.rrdatas ?? []) as string[]).join(' ')}`).join('; ')}`;
  if (p.primaryBackup) return 'Failover (primary and backup)';
  return 'Routing policy';
}

export function mapRecordSet(r: Any): DnsRecordSet {
  return {
    name: String(r?.name ?? ''),
    type: String(r?.type ?? ''),
    ttl: Number(r?.ttl ?? 0),
    rrdatas: ((r?.rrdatas ?? []) as Any[]).map(String),
    routingPolicy: routingPolicyText(r?.routingPolicy),
  };
}

export function mapChange(c: Any): DnsChangeView {
  return {
    id: String(c?.id ?? ''),
    status: String(c?.status ?? ''),
    startTime: str(c?.startTime),
    additions: ((c?.additions ?? []) as Any[]).map(mapRecordSet),
    deletions: ((c?.deletions ?? []) as Any[]).map(mapRecordSet),
  };
}

/** Every record of a change must be inside the zone (SPEC-0008 D-10). */
export function checkChange(zoneDnsName: string, change: DnsChange): void {
  const suffix = zoneDnsName.toLowerCase();
  for (const [i, r] of [...change.additions, ...change.deletions].entries()) {
    const n = r.name.toLowerCase();
    if (n !== suffix && !n.endsWith(`.${suffix}`)) {
      throw ProblemException.of('INVALID_ARGUMENT', `${r.name} is not inside the zone ${zoneDnsName}.`, {
        errors: [{ path: `records.${i}.name`, message: 'Outside the zone' }],
      });
    }
  }
}

/** Cloud DNS through REST (SPEC-0008 D-10, SPEC-0001 D-29). */
@Injectable()
export class DnsService {
  constructor(private readonly operations: OperationsService) {}

  private client(h: ProfileHandle, projectId: string) {
    return rest(h, `${DNS}projects/${projectId}/`);
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, zone: string | null) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'dns',
      kind,
      resource: { name, displayName, href: zone ? `/p/${projectId}/dns/${zone}` : `/p/${projectId}/dns` },
    });
  }

  async zones(h: ProfileHandle, projectId: string): Promise<DnsZoneView[]> {
    return (await this.client(h, projectId).all<Any>('managedZones', 'managedZones', {}, 1000)).map(mapZone);
  }

  async zone(h: ProfileHandle, projectId: string, zone: string): Promise<DnsZoneView> {
    return mapZone(await this.client(h, projectId).get<Any>(`managedZones/${zone}`));
  }

  async createZone(h: ProfileHandle, projectId: string, b: CreateDnsZone): Promise<DnsZoneView> {
    const created = await this.client(h, projectId).post<Any>('managedZones', {
      name: b.name,
      dnsName: b.dnsName,
      description: b.description,
      visibility: b.visibility,
      privateVisibilityConfig:
        b.visibility === 'private'
          ? {
              networks: b.networks.map((n) => ({
                networkUrl: `https://www.googleapis.com/compute/v1/projects/${projectId}/global/networks/${n}`,
              })),
            }
          : undefined,
      dnssecConfig: b.visibility === 'public' && b.dnssec ? { state: 'on' } : undefined,
    });
    this.record(h, projectId, 'dns.zone.create', b.name, `Create zone ${b.name}`, b.name);
    return mapZone(created);
  }

  async deleteZone(h: ProfileHandle, projectId: string, zone: string): Promise<void> {
    await this.client(h, projectId).delete(`managedZones/${zone}`);
    this.record(h, projectId, 'dns.zone.delete', zone, `Delete zone ${zone}`, null);
  }

  async records(h: ProfileHandle, projectId: string, zone: string): Promise<DnsRecordSet[]> {
    return (await this.client(h, projectId).all<Any>(`managedZones/${zone}/rrsets`, 'rrsets', {}, 10_000)).map(mapRecordSet);
  }

  async changes(h: ProfileHandle, projectId: string, zone: string): Promise<DnsChangeView[]> {
    const page = await this.client(h, projectId).page<Any>(`managedZones/${zone}/changes`, 'changes', {
      sortBy: 'changeSequence',
      sortOrder: 'descending',
      maxResults: 50,
    });
    return page.items.map(mapChange);
  }

  async change(h: ProfileHandle, projectId: string, zone: string, id: string): Promise<DnsChangeView> {
    return mapChange(await this.client(h, projectId).get<Any>(`managedZones/${zone}/changes/${id}`));
  }

  /** Applies a change set; deletions must match the current record sets exactly (Cloud DNS rule). */
  async applyChange(h: ProfileHandle, projectId: string, zone: string, change: DnsChange): Promise<DnsChangeView> {
    const z = await this.zone(h, projectId, zone);
    checkChange(z.dnsName, change);
    const created = await this.client(h, projectId).post<Any>(`managedZones/${zone}/changes`, {
      additions: change.additions,
      deletions: change.deletions,
    });
    const n = change.additions.length + change.deletions.length;
    this.record(h, projectId, 'dns.changes.create', zone, `Apply ${n} record change${n === 1 ? '' : 's'} to ${zone}`, zone);
    return mapChange(created);
  }
}

const p = { schema: ProjectIdParamSchema };
const zoneParam = { schema: z.string().regex(/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/) };

@Controller('api/projects/:projectId/dns')
export class DnsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly dns: DnsService,
  ) {}

  @Get('zones')
  zones(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.dns.zones(this.profiles.get(profileId), projectId);
  }

  @Post('zones')
  @Mutation({ product: 'dns', verb: 'zone.create', resource: 'projects/:projectId' })
  createZone(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateDnsZoneSchema }) b: CreateDnsZone,
  ) {
    return this.dns.createZone(this.profiles.get(profileId), projectId, b);
  }

  @Get('zones/:zone')
  zone(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string, @Param('zone', zoneParam) zone: string) {
    return this.dns.zone(this.profiles.get(profileId), projectId, zone);
  }

  @Delete('zones/:zone')
  @HttpCode(204)
  @Mutation({ product: 'dns', verb: 'zone.delete', resource: 'projects/:projectId/managedZones/:zone' })
  async deleteZone(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('zone', zoneParam) zone: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, zone);
    await this.dns.deleteZone(this.profiles.get(profileId), projectId, zone);
  }

  @Get('zones/:zone/records')
  records(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string, @Param('zone', zoneParam) zone: string) {
    return this.dns.records(this.profiles.get(profileId), projectId, zone);
  }

  @Get('zones/:zone/changes')
  changes(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string, @Param('zone', zoneParam) zone: string) {
    return this.dns.changes(this.profiles.get(profileId), projectId, zone);
  }

  @Get('zones/:zone/changes/:id')
  change(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('zone', zoneParam) zone: string,
    @Param('id', { schema: z.string().regex(/^\d{1,20}$/) }) id: string,
  ) {
    return this.dns.change(this.profiles.get(profileId), projectId, zone, id);
  }

  @Post('zones/:zone/changes')
  @Mutation({ product: 'dns', verb: 'changes.create', resource: 'projects/:projectId/managedZones/:zone' })
  apply(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('zone', zoneParam) zone: string,
    @Body({ schema: DnsChangeSchema }) change: DnsChange,
  ) {
    return this.dns.applyChange(this.profiles.get(profileId), projectId, zone, change);
  }
}

/** Cloud DNS (SPEC-0008 M6.4). */
@Module({ controllers: [DnsController], providers: [DnsService] })
export class DnsModule {}
