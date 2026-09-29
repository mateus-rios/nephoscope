import type { PublishRules, Ruleset, RulesIssue, RulesState, RulesTestResult, TestRules } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { FirestoreClients } from './firestore-clients.js';

// biome-ignore lint/suspicious/noExplicitAny: REST responses are loosely typed at this boundary.
type Any = any;

const FILE = 'firestore.rules';
const HISTORY = 30;

/** Security Rules through the Firebase Rules API (SPEC-0004 D-12). */
@Injectable()
export class FirestoreRulesService {
  constructor(
    private readonly clients: GcpClientFactory,
    private readonly fs: FirestoreClients,
    private readonly operations: OperationsService,
  ) {}

  private async api(h: ProfileHandle): Promise<Any> {
    if (this.fs.emulator)
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        'The Rules API is not available with the Firestore emulator; the emulator reads rules from a local file.',
        {
          reason: 'EMULATOR_UNSUPPORTED',
        },
      );
    const { firebaserules } = await sdk.firebaseRules();
    return this.clients.get(h.profile.id, 'firebaserules', (auth) => firebaserules({ version: 'v1', auth: auth as never }));
  }

  /** cloud.firestore for (default), cloud.firestore/{database} otherwise. */
  releaseName(projectId: string, databaseId: string): string {
    return `projects/${projectId}/releases/${databaseId === '(default)' ? 'cloud.firestore' : `cloud.firestore/${databaseId}`}`;
  }

  private mapRuleset(r: Any): Ruleset {
    const name = String(r.name);
    return {
      name,
      id: name.split('/').pop() ?? name,
      createTime: r.createTime ?? null,
      source: (r.source?.files ?? []).map((f: Any) => String(f.content ?? '')).join('\n'),
    };
  }

  async state(h: ProfileHandle, projectId: string, databaseId: string): Promise<RulesState> {
    const api = await this.api(h);
    const releaseName = this.releaseName(projectId, databaseId);
    let current: Ruleset | null = null;
    try {
      const { data: release } = await api.projects.releases.get({ name: releaseName });
      if (release.rulesetName) current = this.mapRuleset((await api.projects.rulesets.get({ name: release.rulesetName })).data);
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    const { data } = await api.projects.rulesets.list({ name: `projects/${projectId}`, pageSize: 100 });
    const history = ((data.rulesets ?? []) as Any[])
      .filter((r) => !r.metadata?.services || r.metadata.services.includes('cloud.firestore'))
      .slice(0, HISTORY)
      .map((r) => ({ name: String(r.name), id: String(r.name).split('/').pop() ?? '', createTime: r.createTime ?? null }));
    return { releaseName: releaseName.replace(/^projects\/[^/]+\/releases\//, ''), current, history };
  }

  async ruleset(h: ProfileHandle, projectId: string, id: string): Promise<Ruleset> {
    const api = await this.api(h);
    const { data } = await api.projects.rulesets.get({ name: `projects/${projectId}/rulesets/${id}` });
    return this.mapRuleset(data);
  }

  private issues(res: Any): RulesIssue[] {
    return ((res?.issues ?? []) as Any[]).map((i) => ({
      line: i.sourcePosition?.line ?? null,
      column: i.sourcePosition?.column ?? null,
      severity: String(i.severity ?? 'ERROR'),
      description: String(i.description ?? ''),
    }));
  }

  /** Checks source without publishing; the editor shows the issues as markers (CA-19). */
  async validate(h: ProfileHandle, projectId: string, source: string): Promise<RulesIssue[]> {
    const api = await this.api(h);
    const { data } = await api.projects.test({
      name: `projects/${projectId}`,
      requestBody: { source: { files: [{ name: FILE, content: source }] } },
    });
    return this.issues(data);
  }

  /** Creates a ruleset and points the release at it; refuses when the release moved since the editor loaded it. */
  async publish(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    body: PublishRules,
  ): Promise<{ ruleset: Ruleset; issues: RulesIssue[] }> {
    const api = await this.api(h);
    const issues = await this.validate(h, projectId, body.source);
    if (issues.some((i) => i.severity === 'ERROR'))
      throw ProblemException.of('INVALID_ARGUMENT', 'The rules have errors. Fix the marked lines and publish again.', {
        errors: issues.map((i) => ({ path: `${i.line ?? 0}:${i.column ?? 0}`, message: i.description })),
      });
    const releaseName = this.releaseName(projectId, databaseId);
    let currentRuleset: string | null = null;
    try {
      currentRuleset = (await api.projects.releases.get({ name: releaseName })).data.rulesetName ?? null;
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    if (body.baseRuleset !== currentRuleset)
      throw ProblemException.of(
        'CONFLICT',
        'The published rules changed since you opened the editor. Reload to see them before publishing.',
        {
          reason: 'RULES_CHANGED',
        },
      );
    const { data: created } = await api.projects.rulesets.create({
      name: `projects/${projectId}`,
      requestBody: { source: { files: [{ name: FILE, content: body.source }] } },
    });
    if (currentRuleset)
      await api.projects.releases.patch({ name: releaseName, requestBody: { release: { name: releaseName, rulesetName: created.name } } });
    else
      await api.projects.releases.create({ name: `projects/${projectId}`, requestBody: { name: releaseName, rulesetName: created.name } });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind: 'firestore.rules.publish',
      resource: {
        name: String(created.name),
        displayName: `Publish rules for ${databaseId}`,
        href: `/p/${projectId}/firestore/${encodeURIComponent(databaseId)}/rules`,
      },
    });
    return { ruleset: this.mapRuleset(created), issues };
  }

  /** The Rules Playground (D-12): get() and exists() in the rules read production data. */
  async test(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    body: TestRules,
  ): Promise<{ issues: RulesIssue[]; results: RulesTestResult[] }> {
    const api = await this.api(h);
    let source = body.source;
    if (source === undefined) {
      const state = await this.state(h, projectId, databaseId);
      if (!state.current) throw ProblemException.of('NOT_FOUND', 'No rules are published for this database.');
      source = state.current.source;
    }
    const testCases = body.cases.map((c) => ({
      expectation: 'ALLOW',
      request: {
        path: `/databases/${databaseId}/documents/${c.path.replace(/^\/+/, '')}`,
        method: c.method,
        ...(c.auth.kind === 'user' ? { auth: { uid: c.auth.uid, token: { ...(c.auth.claims ?? {}), sub: c.auth.uid } } } : {}),
        // The incoming document of a create or update is request.resource.
        ...(c.data && (c.method === 'create' || c.method === 'update') ? { resource: { data: c.data } } : {}),
      },
    }));
    const { data } = await api.projects.test({
      name: `projects/${projectId}`,
      requestBody: { source: { files: [{ name: FILE, content: source }] }, testSuite: { testCases } },
    });
    const results = ((data.testResults ?? []) as Any[]).map((r) => ({
      allowed: r.state === 'SUCCESS',
      state: String(r.state ?? 'STATE_UNSPECIFIED'),
      debugMessages: (r.debugMessages ?? []).map(String),
      errorPosition: r.errorPosition?.line ? { line: Number(r.errorPosition.line), column: Number(r.errorPosition.column ?? 0) } : null,
      evaluations: ((r.expressionReports ?? r.visitedExpressions ?? []) as Any[]).slice(0, 50).map((e) => ({
        expression: String(e.sourcePosition ? `line ${e.sourcePosition.line}` : ''),
        value: JSON.stringify(e.values ?? e.value ?? null),
        line: e.sourcePosition?.line ?? null,
        column: e.sourcePosition?.column ?? null,
      })),
    }));
    return { issues: this.issues(data), results };
  }
}
