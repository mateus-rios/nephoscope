import { ProjectsClient } from '@google-cloud/resource-manager';
import { ServiceUsageClient } from '@google-cloud/service-usage';
import { type Capabilities, permissionCatalog } from '@nephoscope/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { ProfileHandle } from '../credentials/profiles.service.js';
import { GcpClientFactory } from '../gcp/client-factory.js';
import { toProblem } from '../problem/google-error.mapper.js';

const TTL_MS = 5 * 60 * 1000;
/** Google does not document the limit; 100 is the observed maximum (SPEC-0001 CA-43). */
const BATCH = 100;

/**
 * Capability probe (SPEC-0001 D-11, CA-43, CA-46): enabled services through Service Usage and
 * granted permissions through `projects.testIamPermissions`. Advisory only.
 */
@Injectable()
export class CapabilitiesService {
  private readonly logger = new Logger('Capabilities');
  private readonly cache = new Map<string, { at: number; value: Promise<Capabilities> }>();
  /** Permission names Google rejected as invalid, so later probes skip them. */
  private readonly invalid = new Set<string>();

  constructor(private readonly clients: GcpClientFactory) {}

  get(handle: ProfileHandle, projectId: string, refresh = false): Promise<Capabilities> {
    const key = `${handle.profile.id}:${projectId}`;
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const value = this.compute(handle, projectId);
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  invalidate(profileId: string, projectId: string): void {
    this.cache.delete(`${profileId}:${projectId}`);
  }

  private async compute(handle: ProfileHandle, projectId: string): Promise<Capabilities> {
    const [services, permissions] = await Promise.all([
      this.enabledServices(handle, projectId),
      this.grantedPermissions(handle, projectId),
    ]);
    return {
      profileId: handle.profile.id,
      projectId,
      checkedAt: new Date().toISOString(),
      services,
      permissions,
    };
  }

  private async enabledServices(handle: ProfileHandle, projectId: string): Promise<Capabilities['services']> {
    const client = this.clients.get(handle.profile.id, 'serviceusage', (auth) => new ServiceUsageClient({ auth }));
    try {
      const enabled: string[] = [];
      for await (const s of client.listServicesAsync({ parent: `projects/${projectId}`, filter: 'state:ENABLED', pageSize: 200 })) {
        const name = s.config?.name ?? s.name?.split('/').pop();
        if (name) enabled.push(name);
      }
      return { known: true, enabled: enabled.sort() };
    } catch (err) {
      const problem = toProblem(err);
      this.logger.debug({ msg: 'Service Usage unavailable; every product shown as available', projectId, code: problem.code });
      return { known: false, enabled: [], problemCode: problem.code };
    }
  }

  private async grantedPermissions(handle: ProfileHandle, projectId: string): Promise<Capabilities['permissions']> {
    const client = this.clients.get(handle.profile.id, 'projects', (auth) => new ProjectsClient({ auth }));
    const catalog = permissionCatalog().filter((p) => !this.invalid.has(p));
    const granted = new Set<string>();
    try {
      for (let i = 0; i < catalog.length; i += BATCH) {
        for (const p of await this.test(client, projectId, catalog.slice(i, i + BATCH))) granted.add(p);
      }
      return { known: true, tested: catalog, granted: [...granted].sort(), invalid: [...this.invalid].sort() };
    } catch (err) {
      this.logger.debug({ msg: 'Permission probe failed', projectId, error: toProblem(err).code });
      return { known: false, tested: [], granted: [], invalid: [...this.invalid].sort() };
    }
  }

  /** Tests a batch; on INVALID_ARGUMENT, splits it to find and exclude the invalid names. */
  private async test(client: ProjectsClient, projectId: string, permissions: string[]): Promise<string[]> {
    if (permissions.length === 0) return [];
    try {
      const [res] = await client.testIamPermissions({ resource: `projects/${projectId}`, permissions });
      return res.permissions ?? [];
    } catch (err) {
      if (toProblem(err).code !== 'INVALID_ARGUMENT') throw err;
      if (permissions.length === 1) {
        const name = permissions[0] as string;
        this.invalid.add(name);
        this.logger.warn({ msg: 'Permission rejected by Google as invalid; excluded from the probe', permission: name });
        return [];
      }
      const mid = Math.ceil(permissions.length / 2);
      const left = await this.test(client, projectId, permissions.slice(0, mid));
      const right = await this.test(client, projectId, permissions.slice(mid));
      return [...left, ...right];
    }
  }
}
