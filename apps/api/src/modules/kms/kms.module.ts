import { createHash, constants as cryptoConstants, verify as cryptoVerify } from 'node:crypto';
import {
  type CreateCryptoKey,
  CreateCryptoKeySchema,
  type CreateKeyRing,
  CreateKeyRingSchema,
  type CryptoKeyView,
  type KeyRingView,
  type KeyVersionView,
  KMS_TOOL_MAX_BYTES,
  KmsIdSchema,
  type KmsTool,
  type KmsToolResult,
  KmsToolSchema,
  ProjectIdParamSchema,
  type UpdateCryptoKey,
  UpdateCryptoKeySchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { crc32c } from '../../core/gcp/crc32c.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Cloud KMS REST resources are read field by field.
type Any = any;

const KMS = 'https://cloudkms.googleapis.com/v1/';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (n: string) => n.split('/').pop() ?? n;
const seconds = (d: unknown): number | null => {
  const m = typeof d === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(d) : null;
  return m ? Number(m[1]) : null;
};

export function mapKeyRing(r: Any): KeyRingView {
  const name = String(r?.name ?? '');
  return { name, id: short(name), location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '', createTime: str(r?.createTime) };
}

export function mapKey(k: Any): CryptoKeyView {
  const name = String(k?.name ?? '');
  return {
    name,
    id: short(name),
    keyRing: name.replace(/\/cryptoKeys\/[^/]+$/, ''),
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    purpose: String(k?.purpose ?? ''),
    protectionLevel: str(k?.versionTemplate?.protectionLevel) ?? str(k?.primary?.protectionLevel),
    algorithm: str(k?.versionTemplate?.algorithm) ?? str(k?.primary?.algorithm),
    primary: k?.primary ? { id: short(String(k.primary.name ?? '')), state: String(k.primary.state ?? '') } : null,
    rotationPeriodSeconds: seconds(k?.rotationPeriod),
    nextRotationTime: str(k?.nextRotationTime),
    destroyScheduledDuration: str(k?.destroyScheduledDuration),
    labels: (k?.labels ?? {}) as Record<string, string>,
    createTime: str(k?.createTime),
  };
}

export function mapVersion(v: Any, primaryName: string | null): KeyVersionView {
  const name = String(v?.name ?? '');
  return {
    name,
    id: short(name),
    state: String(v?.state ?? ''),
    algorithm: str(v?.algorithm),
    protectionLevel: str(v?.protectionLevel),
    createTime: str(v?.createTime),
    destroyTime: str(v?.destroyTime) ?? str(v?.destroyEventTime),
    primary: !!primaryName && name === primaryName,
  };
}

/** The digest an asymmetric signing algorithm signs, or null when it signs the data itself. */
export function signDigest(algorithm: string): 'sha256' | 'sha384' | 'sha512' | null {
  if (/ED25519/.test(algorithm)) return null;
  if (/SHA512/.test(algorithm)) return 'sha512';
  if (/SHA384|P384/.test(algorithm)) return 'sha384';
  return 'sha256';
}

/** Verifies a KMS signature locally with the version's public key. */
export function verifySignature(algorithm: string, pem: string, data: Buffer, signature: Buffer): boolean {
  const digest = signDigest(algorithm);
  if (digest === null) return cryptoVerify(null, data, pem, signature);
  if (/^EC_/.test(algorithm)) return cryptoVerify(digest, data, { key: pem, dsaEncoding: 'der' }, signature);
  if (/PSS/.test(algorithm)) {
    return cryptoVerify(
      digest,
      data,
      { key: pem, padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength: createHash(digest).digest().length },
      signature,
    );
  }
  return cryptoVerify(digest, data, { key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING }, signature);
}

function decodeInput(b64: string): Buffer {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > KMS_TOOL_MAX_BYTES) throw ProblemException.of('INVALID_ARGUMENT', 'Inputs are limited to 64 KiB.');
  return bytes;
}

function utf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Cloud KMS through REST (SPEC-0007 D-08). */
@Injectable()
export class KmsService {
  private readonly locationsCache = new Map<string, Promise<string[]>>();

  constructor(private readonly operations: OperationsService) {}

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string) {
    const ring = /\/locations\/([^/]+)\/keyRings\/([^/]+)/.exec(name);
    const href = ring ? `/p/${projectId}/kms/${ring[1]}/${ring[2]}` : `/p/${projectId}/kms`;
    this.operations.recordInstant({ profileId: h.profile.id, projectId, product: 'kms', kind, resource: { name, displayName, href } });
  }

  locations(h: ProfileHandle, projectId: string): Promise<string[]> {
    const key = `${h.profile.id}:${projectId}`;
    let p = this.locationsCache.get(key);
    if (!p) {
      p = rest(h, KMS)
        .all<Any>(`projects/${projectId}/locations`, 'locations', { pageSize: 500 }, 1000)
        .then((l) =>
          l
            .map((x) => String(x?.locationId ?? ''))
            .filter(Boolean)
            .sort(),
        );
      p.catch(() => this.locationsCache.delete(key));
      this.locationsCache.set(key, p);
    }
    return p;
  }

  async keyRings(h: ProfileHandle, projectId: string, location: string): Promise<{ items: KeyRingView[]; unreachable?: string[] }> {
    const client = rest(h, KMS);
    const list = async (loc: string) =>
      (await client.all<Any>(`projects/${projectId}/locations/${loc}/keyRings`, 'keyRings', { pageSize: 1000 })).map(mapKeyRing);
    if (location !== 'all') return { items: await list(location) };
    const r = await fanOut(await this.locations(h, projectId), list);
    return { items: r.items.sort((a, b) => a.location.localeCompare(b.location) || a.id.localeCompare(b.id)), unreachable: r.unreachable };
  }

  async createKeyRing(h: ProfileHandle, projectId: string, b: CreateKeyRing): Promise<KeyRingView> {
    const r = await rest(h, KMS).post<Any>(`projects/${projectId}/locations/${b.location}/keyRings`, {}, { keyRingId: b.id });
    this.record(h, projectId, 'kms.keyRing.create', r.name, `Create key ring ${b.id}`);
    return mapKeyRing(r);
  }

  async keys(h: ProfileHandle, ring: string): Promise<CryptoKeyView[]> {
    return (await rest(h, KMS).all<Any>(`${ring}/cryptoKeys`, 'cryptoKeys', { pageSize: 1000 })).map(mapKey);
  }

  async getKey(h: ProfileHandle, key: string): Promise<CryptoKeyView> {
    return mapKey(await rest(h, KMS).get(key));
  }

  async createKey(h: ProfileHandle, projectId: string, ring: string, b: CreateCryptoKey): Promise<CryptoKeyView> {
    const body: Any = {
      purpose: b.purpose,
      versionTemplate: { protectionLevel: b.protectionLevel, algorithm: b.algorithm },
      labels: b.labels,
    };
    if (b.rotationPeriodSeconds && b.purpose === 'ENCRYPT_DECRYPT') {
      body.rotationPeriod = `${b.rotationPeriodSeconds}s`;
      body.nextRotationTime = new Date(Date.now() + b.rotationPeriodSeconds * 1000).toISOString();
    }
    const k = await rest(h, KMS).post<Any>(`${ring}/cryptoKeys`, body, { cryptoKeyId: b.id });
    this.record(h, projectId, 'kms.key.create', k.name, `Create key ${b.id}`);
    return mapKey(k);
  }

  async updateKey(h: ProfileHandle, projectId: string, key: string, b: UpdateCryptoKey): Promise<CryptoKeyView> {
    const body: Any = {};
    const mask: string[] = [];
    if (b.rotationPeriodSeconds !== undefined) {
      if (b.rotationPeriodSeconds) {
        body.rotationPeriod = `${b.rotationPeriodSeconds}s`;
        body.nextRotationTime = new Date(Date.now() + b.rotationPeriodSeconds * 1000).toISOString();
      }
      mask.push('rotation_period', 'next_rotation_time');
    }
    if (b.labels) {
      body.labels = b.labels;
      mask.push('labels');
    }
    if (mask.length === 0) throw ProblemException.of('INVALID_ARGUMENT', 'Nothing to change.');
    const k = await rest(h, KMS).patch<Any>(key, body, { updateMask: mask.join(',') });
    this.record(h, projectId, 'kms.key.update', key, `Update key ${short(key)}`);
    return mapKey(k);
  }

  async versions(h: ProfileHandle, key: string): Promise<KeyVersionView[]> {
    const client = rest(h, KMS);
    const [k, list] = await Promise.all([
      client.get<Any>(key),
      client.all<Any>(`${key}/cryptoKeyVersions`, 'cryptoKeyVersions', { pageSize: 1000 }),
    ]);
    return list.map((v) => mapVersion(v, k?.primary?.name ?? null)).sort((a, b) => Number(b.id) - Number(a.id));
  }

  async createVersion(h: ProfileHandle, projectId: string, key: string): Promise<KeyVersionView> {
    const v = await rest(h, KMS).post<Any>(`${key}/cryptoKeyVersions`, {});
    this.record(h, projectId, 'kms.version.create', v.name, `Rotate key ${short(key)}`);
    return mapVersion(v, null);
  }

  async versionAction(
    h: ProfileHandle,
    projectId: string,
    key: string,
    version: string,
    action: 'enable' | 'disable' | 'destroy' | 'restore' | 'primary',
  ): Promise<void> {
    const client = rest(h, KMS);
    const name = `${key}/cryptoKeyVersions/${version}`;
    if (action === 'enable' || action === 'disable')
      await client.patch(name, { state: action === 'enable' ? 'ENABLED' : 'DISABLED' }, { updateMask: 'state' });
    else if (action === 'primary') await client.post(`${key}:updatePrimaryVersion`, { cryptoKeyVersionId: version });
    else await client.post(`${name}:${action}`, {});
    this.record(
      h,
      projectId,
      `kms.version.${action}`,
      name,
      `${action === 'primary' ? 'Make primary' : action[0]?.toUpperCase() + action.slice(1)} version ${version} of ${short(key)}`,
    );
  }

  /** Encrypt, decrypt, sign, verify and MAC (SPEC-0007 D-08); every use is audited by the route. */
  async tool(h: ProfileHandle, key: string, t: KmsTool): Promise<KmsToolResult> {
    const client = rest(h, KMS);
    const input = decodeInput(t.input);
    const version = t.version ? `${key}/cryptoKeyVersions/${t.version}` : null;
    const needVersion = () => {
      if (!version) throw ProblemException.of('INVALID_ARGUMENT', 'Choose a key version for this operation.');
      return version;
    };
    switch (t.op) {
      case 'encrypt': {
        const r = await client.post<Any>(`${key}:encrypt`, { plaintext: input.toString('base64'), plaintextCrc32c: String(crc32c(input)) });
        return { output: String(r?.ciphertext ?? ''), text: null, verified: null, version: short(String(r?.name ?? '')) };
      }
      case 'decrypt': {
        const r = version
          ? await client.post<Any>(`${version}:asymmetricDecrypt`, { ciphertext: input.toString('base64') })
          : await client.post<Any>(`${key}:decrypt`, { ciphertext: input.toString('base64') });
        const plain = Buffer.from(String(r?.plaintext ?? ''), 'base64');
        return { output: plain.toString('base64'), text: utf8(plain), verified: null, version: t.version ?? null };
      }
      case 'sign': {
        const v = needVersion();
        const meta = await client.get<Any>(v);
        const digest = signDigest(String(meta?.algorithm ?? ''));
        const body = digest
          ? { digest: { [digest]: createHash(digest).update(input).digest('base64') } }
          : { data: input.toString('base64') };
        const r = await client.post<Any>(`${v}:asymmetricSign`, body);
        return { output: String(r?.signature ?? ''), text: null, verified: null, version: t.version ?? null };
      }
      case 'verify': {
        const v = needVersion();
        if (!t.signature) throw ProblemException.of('INVALID_ARGUMENT', 'Paste the signature to verify.');
        const pk = await client.get<Any>(`${v}/publicKey`);
        const ok = verifySignature(String(pk?.algorithm ?? ''), String(pk?.pem ?? ''), input, Buffer.from(t.signature, 'base64'));
        return { output: null, text: null, verified: ok, version: t.version ?? null };
      }
      case 'macSign': {
        const r = await client.post<Any>(`${needVersion()}:macSign`, { data: input.toString('base64') });
        return { output: String(r?.mac ?? ''), text: null, verified: null, version: t.version ?? null };
      }
      case 'macVerify': {
        if (!t.signature) throw ProblemException.of('INVALID_ARGUMENT', 'Paste the MAC to verify.');
        const r = await client.post<Any>(`${needVersion()}:macVerify`, { data: input.toString('base64'), mac: t.signature });
        return { output: null, text: null, verified: !!r?.success, version: t.version ?? null };
      }
    }
  }

  async autokey(h: ProfileHandle, projectId: string): Promise<{ keyProject: string | null }> {
    const r = await rest(h, KMS)
      .get<Any>(`projects/${projectId}:showEffectiveAutokeyConfig`)
      .catch(() => null);
    return { keyProject: str(r?.keyProject) };
  }
}

const p = { schema: ProjectIdParamSchema };
const loc = { schema: z.string().regex(/^[a-z0-9-]{1,64}$/) };
const kid = { schema: KmsIdSchema };
const ver = { schema: z.string().regex(/^[0-9]{1,10}$/) };
const RING = 'projects/:projectId/locations/:location/keyRings/:ring';
const ringName = (p: string, l: string, r: string) => `projects/${p}/locations/${l}/keyRings/${r}`;
/** Only destroy needs the typed version id. */
const OptionalConfirmSchema = z.object({ confirm: z.string().max(256).optional() }).default({});

@Controller('api/projects/:projectId/kms')
export class KmsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly kms: KmsService,
  ) {}

  @Get('locations')
  locations(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<string[]> {
    return this.kms.locations(this.profiles.get(profileId), projectId);
  }

  @Get('autokey')
  autokey(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.kms.autokey(this.profiles.get(profileId), projectId);
  }

  @Get('keyrings')
  keyRings(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({
      schema: z.object({
        location: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .default('global'),
      }),
    })
    q: { location: string },
  ) {
    return this.kms.keyRings(this.profiles.get(profileId), projectId, q.location);
  }

  @Post('keyrings')
  @Mutation({ product: 'kms', verb: 'keyRing.create', resource: 'projects/:projectId/keyRings' })
  createKeyRing(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateKeyRingSchema }) body: CreateKeyRing,
  ) {
    return this.kms.createKeyRing(this.profiles.get(profileId), projectId, body);
  }

  @Get('keyrings/:location/:ring/keys')
  keys(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
  ) {
    return this.kms.keys(this.profiles.get(profileId), ringName(projectId, location, ring));
  }

  @Post('keyrings/:location/:ring/keys')
  @Mutation({ product: 'kms', verb: 'key.create', resource: RING })
  createKey(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Body({ schema: CreateCryptoKeySchema }) body: CreateCryptoKey,
  ) {
    return this.kms.createKey(this.profiles.get(profileId), projectId, ringName(projectId, location, ring), body);
  }

  @Get('keyrings/:location/:ring/keys/:key')
  key(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
  ) {
    return this.kms.getKey(this.profiles.get(profileId), `${ringName(projectId, location, ring)}/cryptoKeys/${key}`);
  }

  @Patch('keyrings/:location/:ring/keys/:key')
  @Mutation({ product: 'kms', verb: 'key.update', resource: `${RING}/cryptoKeys/:key` })
  updateKey(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
    @Body({ schema: UpdateCryptoKeySchema }) body: UpdateCryptoKey,
  ) {
    return this.kms.updateKey(this.profiles.get(profileId), projectId, `${ringName(projectId, location, ring)}/cryptoKeys/${key}`, body);
  }

  @Get('keyrings/:location/:ring/keys/:key/versions')
  versions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
  ) {
    return this.kms.versions(this.profiles.get(profileId), `${ringName(projectId, location, ring)}/cryptoKeys/${key}`);
  }

  @Post('keyrings/:location/:ring/keys/:key/versions')
  @Mutation({ product: 'kms', verb: 'version.create', resource: `${RING}/cryptoKeys/:key` })
  createVersion(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
  ) {
    return this.kms.createVersion(this.profiles.get(profileId), projectId, `${ringName(projectId, location, ring)}/cryptoKeys/${key}`);
  }

  @Post('keyrings/:location/:ring/keys/:key/versions/:version/:action')
  @HttpCode(204)
  @Mutation({ product: 'kms', verb: 'version.:action', resource: `${RING}/cryptoKeys/:key/cryptoKeyVersions/:version` })
  async versionAction(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
    @Param('version', ver) version: string,
    @Param('action', { schema: z.enum(['enable', 'disable', 'destroy', 'restore', 'primary']) }) action:
      | 'enable'
      | 'disable'
      | 'destroy'
      | 'restore'
      | 'primary',
    @Body({ schema: OptionalConfirmSchema }) body: { confirm?: string },
  ): Promise<void> {
    if (action === 'destroy') requireConfirmation(body.confirm, version);
    await this.kms.versionAction(
      this.profiles.get(profileId),
      projectId,
      `${ringName(projectId, location, ring)}/cryptoKeys/${key}`,
      version,
      action,
    );
  }

  /** Crypto tools: reads, allowed in read-only mode, and every use is audited (SPEC-0007 D-08, CA-08). */
  @Post('keyrings/:location/:ring/keys/:key/tool')
  @HttpCode(200)
  @Mutation({ product: 'kms', verb: 'key.use', resource: `${RING}/cryptoKeys/:key`, scope: 'reveal' })
  tool(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('ring', kid) ring: string,
    @Param('key', kid) key: string,
    @Body({ schema: KmsToolSchema }) body: KmsTool,
  ): Promise<KmsToolResult> {
    return this.kms.tool(this.profiles.get(profileId), `${ringName(projectId, location, ring)}/cryptoKeys/${key}`, body);
  }
}

/** Cloud KMS (SPEC-0007 M5.2). */
@Module({ controllers: [KmsController], providers: [KmsService] })
export class KmsModule {}
