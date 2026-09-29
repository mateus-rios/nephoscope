import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { loadConfig, type NephoscopeConfig } from '../src/core/config/config.js';
import { JsonLogger } from '../src/core/logging/json-logger.js';
import { AccessToken } from '../src/core/security/access-token.js';
import { createApp } from '../src/main.js';

const H = { 'x-nephoscope-client': '1' };

async function start(overrides: Partial<NephoscopeConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'nephoscope-e2e-'));
  const config: NephoscopeConfig = {
    ...loadConfig({}),
    dataDir,
    credentialsFile: null,
    webDist: join(dataDir, 'no-web'),
    ...overrides,
  };
  const token = new AccessToken('t'.repeat(40));
  const app: NestExpressApplication = await createApp(config, token, new JsonLogger('error'));
  await app.init();
  return { app, server: app.getHttpServer(), token };
}

describe('Nephoscope API (SPEC-0001 §8.2 and §8.8)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    ctx = await start();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('answers health without the client header', async () => {
    await request(ctx.server).get('/api/health').expect(200, { status: 'ok' });
  });

  it('T-09: refuses API calls without the client header', async () => {
    const res = await request(ctx.server).get('/api/instance').expect(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('CLIENT_HEADER_REQUIRED');
  });

  it('T-08: refuses unknown hosts with 421', async () => {
    const res = await request(ctx.server).get('/api/instance').set(H).set('Host', 'evil.example').expect(421);
    expect(res.body.code).toBe('HOST_NOT_ALLOWED');
  });

  it('T-10: refuses cross-site requests', async () => {
    const a = await request(ctx.server).post('/api/profiles').set(H).set('Origin', 'http://evil.example').send({ key: '{}' }).expect(403);
    expect(a.body.code).toBe('CROSS_SITE_REQUEST');
    const b = await request(ctx.server).get('/api/instance').set(H).set('Sec-Fetch-Site', 'cross-site').expect(403);
    expect(b.body.code).toBe('CROSS_SITE_REQUEST');
    const c = await request(ctx.server).options('/api/profiles').expect(403);
    expect(c.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets the security headers of CA-18', async () => {
    const res = await request(ctx.server).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports instance state with no credentials (T-02)', async () => {
    const res = await request(ctx.server).get('/api/instance').set(H).expect(200);
    expect(res.body.credentials.environmentMissing).toBe(true);
    expect(res.body.credentials.environmentFileSet).toBe(false);
    expect(res.body.host.isLoopback).toBe(true);
  });

  it('T-31: validates bodies with the route schema', async () => {
    const res = await request(ctx.server).post('/api/profiles').set(H).send({ key: 'x' }).expect(400);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
    expect(res.body.errors[0].path).toBe('key');
  });

  it('T-03: reports the failing step of an invalid key', async () => {
    const parse = await request(ctx.server).post('/api/profiles').set(H).send({ key: '{not json' }).expect(400);
    expect(parse.body.errors[0].message).toMatch(/^parse:/);
    const type = await request(ctx.server).post('/api/profiles').set(H).send({ key: '{"type":"foo"}' }).expect(400);
    expect(type.body.errors[0].message).toMatch(/^type:/);
  });

  it('asks for a profile when none exists', async () => {
    const res = await request(ctx.server).get('/api/projects').set(H).expect(400);
    expect(res.body.code).toBe('NO_CREDENTIALS');
    const unknown = await request(ctx.server).get('/api/projects').set(H).set('x-nephoscope-profile', 'nope').expect(400);
    expect(unknown.body.code).toBe('UNKNOWN_PROFILE');
  });

  it('returns problem+json for unknown API routes', async () => {
    const res = await request(ctx.server).get('/api/nothing-here').set(H).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('read-only mode (T-16)', () => {
  it('rejects mutations and audits the rejection', async () => {
    const ctx = await start({ readOnly: true });
    try {
      const res = await request(ctx.server).post('/api/projects/acme-dev/services/run.googleapis.com/enable').set(H).send({}).expect(403);
      expect(res.body.code).toBe('READ_ONLY');
      const audit = await request(ctx.server).get('/api/audit').set(H).expect(200);
      expect(audit.body[0]).toMatchObject({
        verb: 'apis.service.enable',
        outcome: 'rejected',
        problemCode: 'READ_ONLY',
        projectId: 'acme-dev',
      });
    } finally {
      await ctx.app.close();
    }
  });
});

describe('access token outside loopback (T-32, T-33)', () => {
  it('requires the token for an allowed non-loopback host, and stores it from the startup URL', async () => {
    const ctx = await start({ allowedHosts: ['nephoscope.lan'] });
    try {
      const denied = await request(ctx.server).get('/api/instance').set(H).set('Host', 'nephoscope.lan').expect(401);
      expect(denied.body.code).toBe('UNAUTHENTICATED');
      const visit = await request(ctx.server).get(`/?token=${ctx.token.value}`).set('Host', 'nephoscope.lan').expect(303);
      expect(visit.headers.location).toBe('/');
      const cookie = String(visit.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      await request(ctx.server)
        .get('/api/instance')
        .set(H)
        .set('Host', 'nephoscope.lan')
        .set('Cookie', cookie.split(';')[0] ?? '')
        .expect(200);
      // Loopback stays open without the token (the user chose no login on localhost).
      await request(ctx.server).get('/api/instance').set(H).expect(200);
    } finally {
      await ctx.app.close();
    }
  });

  it('requires the token on loopback too with NEPHOSCOPE_REQUIRE_TOKEN', async () => {
    const ctx = await start({ requireToken: true });
    try {
      await request(ctx.server).get('/api/instance').set(H).expect(401);
      await request(ctx.server).get('/api/instance').set(H).set('Authorization', `Bearer ${ctx.token.value}`).expect(200);
    } finally {
      await ctx.app.close();
    }
  });
});
