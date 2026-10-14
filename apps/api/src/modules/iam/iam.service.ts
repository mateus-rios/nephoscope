import { randomBytes } from 'node:crypto';
import {
  type AddKeyAsProfile,
  type CreateServiceAccount,
  type IamPolicyView,
  type InheritedPolicy,
  type NewKeyView,
  owners,
  type Profile,
  type ProjectIamView,
  type RoleDetail,
  type RoleSearch,
  type RoleSummary,
  type SaveCustomRole,
  type ServiceAccountKeyView,
  type ServiceAccountView,
  type SetIamPolicy,
  type TestablePermission,
  type Troubleshoot,
  type TroubleshootView,
  type UpdateServiceAccount,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { mapKey, mapPolicy, mapRole, mapServiceAccount, mapTestable, mapTroubleshoot, memberOf, policyBody } from './iam-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: IAM REST resources are read field by field.
type Any = any;

const CRM1 = 'https://cloudresourcemanager.googleapis.com/v1/';
const CRM3 = 'https://cloudresourcemanager.googleapis.com/v3/';
const IAM = 'https://iam.googleapis.com/v1/';
const ROLES_TTL = 24 * 3_600_000;
const KEY_TTL = 10 * 60_000;
/** Google does not document the limit; 100 is the observed maximum (SPEC-0001 CA-43). */
const TEST_BATCH = 100;

interface StashedKey {
  json: string;
  projectId: string;
  expires: number;
  downloaded: boolean;
  added: boolean;
}

/** Self and last-owner checks of a policy change (SPEC-0007 D-01), done on the server too. */
export function policyRisks(
  before: IamPolicyView,
  after: SetIamPolicy,
  self: string | null,
): { removesSelf: boolean; removesLastOwner: boolean } {
  const had = self ? before.bindings.some((b) => b.members.includes(self)) : false;
  const keeps = self ? after.bindings.some((b) => b.members.includes(self)) : true;
  const ownersBefore = owners(before.bindings);
  const ownersAfter = owners(after.bindings.map((b) => ({ ...b, condition: b.condition ?? null })));
  return { removesSelf: had && !keeps, removesLastOwner: ownersBefore.length > 0 && ownersAfter.length === 0 };
}

/** IAM through REST (SPEC-0007 D-01 to D-05, SPEC-0001 D-29). */
@Injectable()
export class IamService {
  private predefined: { at: number; value: Promise<RoleDetail[]> } | null = null;
  private readonly testable = new Map<string, Promise<TestablePermission[]>>();
  private readonly keys = new Map<string, StashedKey>();

  constructor(
    private readonly operations: OperationsService,
    private readonly profiles: ProfilesService,
  ) {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.keys) if (v.expires < now) this.keys.delete(k);
    }, 60_000);
    sweep.unref();
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, href: string) {
    this.operations.recordInstant({ profileId: h.profile.id, projectId, product: 'iam', kind, resource: { name, displayName, href } });
  }

  // ---- project policy --------------------------------------------------------------------------

  private async readPolicy(h: ProfileHandle, resource: string): Promise<IamPolicyView> {
    const p = await rest(h, CRM3).post<Any>(`${resource}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
    return mapPolicy(p);
  }

  /** The project policy and, when the key can read them, the bindings inherited from ancestors. */
  async projectPolicy(h: ProfileHandle, projectId: string): Promise<ProjectIamView> {
    const policy = await this.readPolicy(h, `projects/${projectId}`);
    const inherited: InheritedPolicy[] = [];
    let inheritedError: string | null = null;
    try {
      const anc = await rest(h, CRM1).post<Any>(`projects/${projectId}:getAncestry`, {});
      const ancestors = ((anc?.ancestor ?? []) as Any[])
        .map((a) => a?.resourceId)
        .filter((r) => r?.type === 'folder' || r?.type === 'organization');
      for (const a of ancestors) {
        const resource = `${a.type === 'folder' ? 'folders' : 'organizations'}/${a.id}`;
        try {
          const [p, meta] = await Promise.all([
            this.readPolicy(h, resource),
            rest(h, CRM3)
              .get<Any>(resource)
              .catch(() => null),
          ]);
          inherited.push({ resource, displayName: meta?.displayName ?? null, bindings: p.bindings });
        } catch (err) {
          inheritedError = `The policy of ${resource} could not be read: ${(err as Error).message}`;
        }
      }
    } catch (err) {
      inheritedError = `The project's ancestry could not be read: ${(err as Error).message}`;
    }
    return { policy, inherited, inheritedError, self: memberOf(h.profile.principal) };
  }

  async setProjectPolicy(h: ProfileHandle, projectId: string, body: SetIamPolicy): Promise<IamPolicyView> {
    const current = await this.readPolicy(h, `projects/${projectId}`);
    if (current.etag !== body.etag) {
      throw ProblemException.of('CONFLICT', 'The policy changed since it was loaded. Reload it to see the other change, then edit again.');
    }
    const risks = policyRisks(current, body, memberOf(h.profile.principal));
    if (risks.removesSelf && !body.confirmSelf) {
      throw ProblemException.of('FAILED_PRECONDITION', 'You are removing your own access to this project. Confirm it to save.', {
        reason: 'REMOVES_SELF',
      });
    }
    if (risks.removesLastOwner && !body.confirmLastOwner) {
      throw ProblemException.of('FAILED_PRECONDITION', 'This removes the last owner of the project. Confirm it to save.', {
        reason: 'REMOVES_LAST_OWNER',
      });
    }
    const updateMask = body.auditConfigs ? 'bindings,etag,auditConfigs' : 'bindings,etag';
    const saved = await rest(h, CRM3).post<Any>(`projects/${projectId}:setIamPolicy`, { policy: policyBody(body), updateMask });
    this.record(h, projectId, 'iam.policy.set', `projects/${projectId}`, 'Save project IAM policy', `/p/${projectId}/iam`);
    return mapPolicy(saved);
  }

  // ---- roles -------------------------------------------------------------------------------------

  private predefinedRoles(h: ProfileHandle): Promise<RoleDetail[]> {
    if (this.predefined && Date.now() - this.predefined.at < ROLES_TTL) return this.predefined.value;
    const value = rest(h, IAM)
      .all<Any>('roles', 'roles', { view: 'FULL', pageSize: 1000 }, 10_000)
      .then((list) => list.map(mapRole).sort((a, b) => a.name.localeCompare(b.name)));
    value.catch(() => {
      this.predefined = null;
    });
    this.predefined = { at: Date.now(), value };
    return value;
  }

  private async customRoles(h: ProfileHandle, projectId: string): Promise<RoleDetail[]> {
    const list = await rest(h, IAM).all<Any>(`projects/${projectId}/roles`, 'roles', { view: 'FULL', showDeleted: true, pageSize: 1000 });
    return list.map(mapRole);
  }

  /** Searches roles by text or by a permission they grant (SPEC-0007 D-03). */
  async searchRoles(h: ProfileHandle, projectId: string, q: RoleSearch): Promise<RoleSummary[]> {
    const [predefined, custom] = await Promise.all([
      q.custom === 'custom' ? Promise.resolve([] as RoleDetail[]) : this.predefinedRoles(h),
      q.custom === 'predefined' ? Promise.resolve([] as RoleDetail[]) : this.customRoles(h, projectId).catch(() => [] as RoleDetail[]),
    ]);
    const words = q.q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...custom, ...predefined]
      .filter(
        (r) =>
          (!q.permission || r.includedPermissions.includes(q.permission)) &&
          words.every((w) => `${r.name} ${r.title}`.toLowerCase().includes(w)),
      )
      .slice(0, 500)
      .map(({ includedPermissions: _p, etag: _e, ...summary }) => summary);
  }

  async getRole(h: ProfileHandle, name: string): Promise<RoleDetail> {
    if (name.startsWith('roles/')) {
      const hit = (await this.predefinedRoles(h)).find((r) => r.name === name);
      if (hit) return hit;
    }
    return mapRole(await rest(h, IAM).get<Any>(name));
  }

  /** Permissions usable in custom roles at the project level (SPEC-0007 D-03). */
  testablePermissions(h: ProfileHandle, projectId: string): Promise<TestablePermission[]> {
    const key = `${h.profile.id}:${projectId}`;
    let p = this.testable.get(key);
    if (!p) {
      p = (async () => {
        const out: TestablePermission[] = [];
        let pageToken: string | undefined;
        do {
          const page = await rest(h, IAM).post<Any>('permissions:queryTestablePermissions', {
            fullResourceName: `//cloudresourcemanager.googleapis.com/projects/${projectId}`,
            pageSize: 1000,
            pageToken,
          });
          out.push(...((page?.permissions ?? []) as Any[]).map(mapTestable));
          pageToken = page?.nextPageToken || undefined;
        } while (pageToken && out.length < 20_000);
        return out.filter((x) => x.supportLevel !== 'NOT_SUPPORTED').sort((a, b) => a.name.localeCompare(b.name));
      })();
      p.catch(() => this.testable.delete(key));
      this.testable.set(key, p);
    }
    return p;
  }

  async createRole(h: ProfileHandle, projectId: string, b: SaveCustomRole): Promise<RoleDetail> {
    const r = await rest(h, IAM).post<Any>(`projects/${projectId}/roles`, {
      roleId: b.roleId,
      role: { title: b.title, description: b.description, stage: b.stage, includedPermissions: b.includedPermissions },
    });
    this.record(h, projectId, 'iam.role.create', r.name, `Create role ${b.title}`, `/p/${projectId}/iam?tab=roles`);
    return mapRole(r);
  }

  async updateRole(h: ProfileHandle, projectId: string, roleId: string, b: SaveCustomRole): Promise<RoleDetail> {
    const r = await rest(h, IAM).patch<Any>(
      `projects/${projectId}/roles/${roleId}`,
      { title: b.title, description: b.description, stage: b.stage, includedPermissions: b.includedPermissions },
      { updateMask: 'title,description,stage,includedPermissions' },
    );
    this.record(h, projectId, 'iam.role.update', r.name, `Update role ${b.title}`, `/p/${projectId}/iam?tab=roles`);
    return mapRole(r);
  }

  async deleteRole(h: ProfileHandle, projectId: string, roleId: string): Promise<void> {
    await rest(h, IAM).delete(`projects/${projectId}/roles/${roleId}`);
    this.record(h, projectId, 'iam.role.delete', roleId, `Delete role ${roleId}`, `/p/${projectId}/iam?tab=roles`);
  }

  async undeleteRole(h: ProfileHandle, projectId: string, roleId: string): Promise<RoleDetail> {
    const r = await rest(h, IAM).post<Any>(`projects/${projectId}/roles/${roleId}:undelete`, {});
    this.record(h, projectId, 'iam.role.undelete', roleId, `Restore role ${roleId}`, `/p/${projectId}/iam?tab=roles`);
    return mapRole(r);
  }

  // ---- service accounts ----------------------------------------------------------------------------------

  async listServiceAccounts(h: ProfileHandle, projectId: string): Promise<ServiceAccountView[]> {
    const client = rest(h, IAM);
    const accounts = await client.all<Any>(`projects/${projectId}/serviceAccounts`, 'accounts', { pageSize: 100 }, 2000);
    const counts = new Map<string, number>();
    await fanOut(
      accounts.map((a) => String(a.email)),
      async (email) => {
        const data = await client.get<Any>(`projects/${projectId}/serviceAccounts/${email}/keys`, { keyTypes: 'USER_MANAGED' });
        counts.set(email, ((data?.keys ?? []) as Any[]).length);
        return [];
      },
    ).catch(() => undefined);
    return accounts
      .map((a) => mapServiceAccount(a, counts.has(a.email) ? (counts.get(a.email) as number) : null))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async getServiceAccount(h: ProfileHandle, projectId: string, email: string): Promise<ServiceAccountView> {
    const a = await rest(h, IAM).get<Any>(`projects/${projectId}/serviceAccounts/${email}`);
    return mapServiceAccount(a, null);
  }

  async createServiceAccount(h: ProfileHandle, projectId: string, b: CreateServiceAccount): Promise<ServiceAccountView> {
    const a = await rest(h, IAM).post<Any>(`projects/${projectId}/serviceAccounts`, {
      accountId: b.accountId,
      serviceAccount: { displayName: b.displayName ?? '', description: b.description ?? '' },
    });
    this.record(
      h,
      projectId,
      'iam.serviceAccount.create',
      a.name,
      `Create service account ${b.accountId}`,
      `/p/${projectId}/iam/serviceaccounts/${a.email}`,
    );
    return mapServiceAccount(a, 0);
  }

  async updateServiceAccount(h: ProfileHandle, projectId: string, email: string, b: UpdateServiceAccount): Promise<ServiceAccountView> {
    const mask = Object.keys(b).filter((k) => b[k as keyof UpdateServiceAccount] !== undefined);
    const a = await rest(h, IAM).patch<Any>(`projects/${projectId}/serviceAccounts/${email}`, {
      serviceAccount: b,
      updateMask: mask.join(','),
    });
    this.record(
      h,
      projectId,
      'iam.serviceAccount.update',
      a.name,
      `Update service account ${email}`,
      `/p/${projectId}/iam/serviceaccounts/${email}`,
    );
    return mapServiceAccount(a, null);
  }

  async setServiceAccountEnabled(h: ProfileHandle, projectId: string, email: string, enabled: boolean): Promise<void> {
    await rest(h, IAM).post(`projects/${projectId}/serviceAccounts/${email}:${enabled ? 'enable' : 'disable'}`, {});
    this.record(
      h,
      projectId,
      `iam.serviceAccount.${enabled ? 'enable' : 'disable'}`,
      email,
      `${enabled ? 'Enable' : 'Disable'} ${email}`,
      `/p/${projectId}/iam/serviceaccounts/${email}`,
    );
  }

  async deleteServiceAccount(h: ProfileHandle, projectId: string, email: string): Promise<void> {
    await rest(h, IAM).delete(`projects/${projectId}/serviceAccounts/${email}`);
    this.record(h, projectId, 'iam.serviceAccount.delete', email, `Delete ${email}`, `/p/${projectId}/iam?tab=serviceaccounts`);
  }

  async undeleteServiceAccount(h: ProfileHandle, projectId: string, uniqueId: string): Promise<ServiceAccountView> {
    const r = await rest(h, IAM).post<Any>(`projects/${projectId}/serviceAccounts/${uniqueId}:undelete`, {});
    const a = mapServiceAccount(r?.restoredAccount ?? {}, null);
    this.record(
      h,
      projectId,
      'iam.serviceAccount.undelete',
      a.email || uniqueId,
      `Restore service account ${a.email || uniqueId}`,
      `/p/${projectId}/iam?tab=serviceaccounts`,
    );
    return a;
  }

  // ---- keys ---------------------------------------------------------------------------------------------

  async listKeys(h: ProfileHandle, projectId: string, email: string): Promise<ServiceAccountKeyView[]> {
    const data = await rest(h, IAM).get<Any>(`projects/${projectId}/serviceAccounts/${email}/keys`);
    return ((data?.keys ?? []) as Any[]).map(mapKey).sort((a, b) => (b.validAfter ?? '').localeCompare(a.validAfter ?? ''));
  }

  /**
   * Creates a JSON key. Its private part is kept in memory for 10 minutes under a random handle,
   * for one download or to add it as a profile without it reaching the browser (SPEC-0007 D-02).
   */
  async createKey(h: ProfileHandle, projectId: string, email: string): Promise<NewKeyView> {
    const k = await rest(h, IAM).post<Any>(`projects/${projectId}/serviceAccounts/${email}/keys`, {
      privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE',
      keyAlgorithm: 'KEY_ALG_RSA_2048',
    });
    const json = Buffer.from(String(k?.privateKeyData ?? ''), 'base64').toString('utf8');
    const handle = randomBytes(32).toString('base64url');
    const expires = Date.now() + KEY_TTL;
    this.keys.set(handle, { json, projectId, expires, downloaded: false, added: false });
    this.record(h, projectId, 'iam.key.create', k.name, `Create key for ${email}`, `/p/${projectId}/iam/serviceaccounts/${email}?tab=keys`);
    const { privateKeyData: _secret, ...meta } = k ?? {};
    return { key: mapKey(meta), handle, expiresAt: new Date(expires).toISOString() };
  }

  private stashed(handle: string): StashedKey {
    const s = this.keys.get(handle);
    if (!s || s.expires < Date.now()) {
      this.keys.delete(handle);
      throw ProblemException.of('NOT_FOUND', 'This new key is no longer held by Nephoscope. Keys are kept for 10 minutes after creation.');
    }
    return s;
  }

  private release(handle: string, s: StashedKey) {
    if (s.downloaded && s.added) this.keys.delete(handle);
  }

  /** The key file, once. */
  downloadKey(handle: string): { json: string; fileName: string } {
    const s = this.stashed(handle);
    if (s.downloaded) throw ProblemException.of('FAILED_PRECONDITION', 'This key was already downloaded once.');
    s.downloaded = true;
    this.release(handle, s);
    const parsed = JSON.parse(s.json) as { client_email?: string; private_key_id?: string };
    return { json: s.json, fileName: `${(parsed.client_email ?? 'key').split('@')[0]}-${(parsed.private_key_id ?? '').slice(0, 12)}.json` };
  }

  async addKeyAsProfile(handle: string, b: AddKeyAsProfile): Promise<Profile> {
    const s = this.stashed(handle);
    if (s.added) throw ProblemException.of('FAILED_PRECONDITION', 'This key is already a profile.');
    const { profile } = await this.profiles.add({
      key: s.json,
      name: b.name,
      colorTag: b.colorTag,
      readOnly: b.readOnly,
      defaultProject: s.projectId,
    });
    s.added = true;
    this.release(handle, s);
    return profile;
  }

  async uploadKey(h: ProfileHandle, projectId: string, email: string, pem: string): Promise<ServiceAccountKeyView> {
    const k = await rest(h, IAM).post<Any>(`projects/${projectId}/serviceAccounts/${email}/keys:upload`, {
      publicKeyData: Buffer.from(pem, 'utf8').toString('base64'),
    });
    this.record(h, projectId, 'iam.key.upload', k.name, `Upload key for ${email}`, `/p/${projectId}/iam/serviceaccounts/${email}?tab=keys`);
    return mapKey(k);
  }

  async setKeyEnabled(h: ProfileHandle, projectId: string, email: string, keyId: string, enabled: boolean): Promise<void> {
    await rest(h, IAM).post(`projects/${projectId}/serviceAccounts/${email}/keys/${keyId}:${enabled ? 'enable' : 'disable'}`, {});
    this.record(
      h,
      projectId,
      `iam.key.${enabled ? 'enable' : 'disable'}`,
      keyId,
      `${enabled ? 'Enable' : 'Disable'} key ${keyId.slice(0, 12)}`,
      `/p/${projectId}/iam/serviceaccounts/${email}?tab=keys`,
    );
  }

  async deleteKey(h: ProfileHandle, projectId: string, email: string, keyId: string): Promise<void> {
    await rest(h, IAM).delete(`projects/${projectId}/serviceAccounts/${email}/keys/${keyId}`);
    this.record(
      h,
      projectId,
      'iam.key.delete',
      keyId,
      `Delete key ${keyId.slice(0, 12)}`,
      `/p/${projectId}/iam/serviceaccounts/${email}?tab=keys`,
    );
  }

  // ---- service account IAM (who can act as it) ------------------------------------------------------------

  async serviceAccountPolicy(h: ProfileHandle, projectId: string, email: string): Promise<IamPolicyView> {
    const p = await rest(h, IAM).post<Any>(
      `projects/${projectId}/serviceAccounts/${email}:getIamPolicy`,
      {},
      { 'options.requestedPolicyVersion': 3 },
    );
    return mapPolicy(p);
  }

  async setServiceAccountPolicy(h: ProfileHandle, projectId: string, email: string, body: SetIamPolicy): Promise<IamPolicyView> {
    const p = await rest(h, IAM).post<Any>(`projects/${projectId}/serviceAccounts/${email}:setIamPolicy`, { policy: policyBody(body) });
    this.record(
      h,
      projectId,
      'iam.serviceAccount.setIamPolicy',
      email,
      `Save who can act as ${email}`,
      `/p/${projectId}/iam/serviceaccounts/${email}?tab=permissions`,
    );
    return mapPolicy(p);
  }

  // ---- testing and troubleshooting --------------------------------------------------------------------------

  async testPermissions(h: ProfileHandle, projectId: string, permissions: string[]): Promise<{ granted: string[]; denied: string[] }> {
    const granted = new Set<string>();
    for (let i = 0; i < permissions.length; i += TEST_BATCH) {
      const batch = permissions.slice(i, i + TEST_BATCH);
      const r = await rest(h, CRM1).post<Any>(`projects/${projectId}:testIamPermissions`, { permissions: batch });
      for (const p of (r?.permissions ?? []) as string[]) granted.add(p);
    }
    return { granted: [...granted].sort(), denied: permissions.filter((p) => !granted.has(p)).sort() };
  }

  async troubleshoot(h: ProfileHandle, projectId: string, b: Troubleshoot): Promise<TroubleshootView> {
    const principal = b.principal.replace(/^(user|serviceAccount|group):/, '');
    const r = await rest(h, 'https://policytroubleshooter.googleapis.com/v3/').post<Any>('iam:troubleshoot', {
      accessTuple: {
        principal,
        fullResourceName: b.fullResourceName || `//cloudresourcemanager.googleapis.com/projects/${projectId}`,
        permission: b.permission,
      },
    });
    return mapTroubleshoot(r);
  }
}
