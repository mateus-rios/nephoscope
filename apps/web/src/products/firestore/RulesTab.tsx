import type { RulesIssue, RulesTestCase, RulesTestResult } from '@nephoscope/contracts';
import { ArrowCounterClockwiseIcon, CheckIcon, EyeIcon, PlayIcon, PlusIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor, DiffEditor, type EditorMarker } from '../../design/code/CodeEditor';
import { Legend, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Input, Select, Textarea } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { ApiError } from '../../lib/api';
import type { AdminContext } from './Admin';
import { fetchRuleset, publishRules, testRules, useRules, validateRules } from './api';

const STARTER = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

interface CaseDraft {
  id: number;
  method: RulesTestCase['method'];
  path: string;
  uid: string;
  claims: string;
  data: string;
}

let nextCase = 1;
const newCase = (): CaseDraft => ({ id: nextCase++, method: 'get', path: 'users/u1', uid: '', claims: '{}', data: '{}' });

const toMarkers = (issues: RulesIssue[]): EditorMarker[] =>
  issues
    .filter((i) => i.line)
    .map((i) => ({
      line: i.line ?? 1,
      column: i.column ?? 1,
      message: i.description,
      severity: i.severity === 'WARNING' ? 'warning' : 'error',
    }));

/** Security Rules: editor, validation, diff before publishing, history and playground (SPEC-0004 D-12, CA-19). */
export function RulesTab({ ctx }: { ctx: AdminContext }) {
  const state = useRules(ctx.projectId, ctx.databaseId);
  const current = state.data?.current ?? null;
  const [source, setSource] = useState('');
  const [loadedFrom, setLoadedFrom] = useState<string | null | undefined>(undefined);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; source: string } | null>(null);
  const [cases, setCases] = useState<CaseDraft[]>([newCase()]);
  const [results, setResults] = useState<RulesTestResult[] | null>(null);
  const [testing, setTesting] = useState(false);

  // The editor starts from the published rules; it is not replaced while someone edits.
  useEffect(() => {
    if (state.data && loadedFrom === undefined) {
      setSource(current?.source ?? STARTER);
      setLoadedFrom(current?.name ?? null);
    }
  }, [state.data, current, loadedFrom]);

  if (ctx.database.emulator)
    return (
      <EmptyState title="Rules are not available in the emulator">
        The emulator reads rules from a local file given at startup. Connect a real project to edit and publish rules.
      </EmptyState>
    );
  if (state.isPending) return <DelayedSkeleton rows={10} className="p-6" />;
  if (state.error instanceof ApiError) return <ProblemState problem={state.error.problem} onRetry={() => void state.refetch()} />;

  const changed = source !== (current?.source ?? '');
  const check = async () => {
    setChecking(true);
    try {
      const issues = await validateRules(ctx.projectId, source);
      setMarkers(toMarkers(issues));
      if (issues.length === 0) toast.success('No issues found');
      return issues;
    } catch (err) {
      toast.error('Checking failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
      return null;
    } finally {
      setChecking(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      const r = await publishRules(ctx.projectId, ctx.databaseId, source, loadedFrom ?? null);
      toast.success(`Published ruleset ${r.ruleset.id}`);
      setLoadedFrom(r.ruleset.name);
      setPublishing(false);
      setMarkers([]);
      void state.refetch();
    } catch (err) {
      if (err instanceof ApiError && err.problem.errors?.length)
        setMarkers(
          err.problem.errors.map((e) => ({
            line: Number(e.path.split(':')[0]) || 1,
            column: Number(e.path.split(':')[1]) || 1,
            message: e.message,
          })),
        );
      toast.error('Publishing failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
      if (err instanceof ApiError && err.problem.reason === 'RULES_CHANGED') void state.refetch();
    } finally {
      setBusy(false);
    }
  };

  const runTests = async () => {
    setTesting(true);
    try {
      const body = {
        source,
        cases: cases.map((c) => ({
          path: c.path,
          method: c.method,
          auth: c.uid.trim()
            ? { kind: 'user' as const, uid: c.uid.trim(), claims: JSON.parse(c.claims || '{}') as Record<string, unknown> }
            : { kind: 'none' as const },
          ...(c.method === 'create' || c.method === 'update' ? { data: JSON.parse(c.data || '{}') as Record<string, unknown> } : {}),
        })),
      };
      const r = await testRules(ctx.projectId, ctx.databaseId, body);
      setResults(r.results);
      setMarkers(toMarkers(r.issues));
    } catch (err) {
      toast.error('The test did not run', {
        description:
          err instanceof ApiError ? err.problem.detail : err instanceof SyntaxError ? 'Claims and data must be JSON objects.' : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-6 py-3">
        <span className="text-meta text-ink-2">
          Release <Mono value={state.data?.releaseName ?? ''} />
          {current ? (
            <>
              {' '}
              points at ruleset <Mono value={current.id} />, published <Timestamp iso={current.createTime} />
            </>
          ) : (
            ', no rules published yet'
          )}
        </span>
        <span className="ml-auto flex gap-2">
          <Button icon={CheckIcon} loading={checking} onClick={() => void check()}>
            Check
          </Button>
          <Button
            variant="commit"
            icon={UploadSimpleIcon}
            disabled={!changed || !!ctx.readOnly}
            disabledReason={ctx.readOnly ?? (changed ? null : 'Nothing changed')}
            onClick={async () => {
              const issues = await check();
              if (issues && !issues.some((i) => i.severity === 'ERROR')) setPublishing(true);
            }}
          >
            Review and publish
          </Button>
        </span>
      </div>
      <div className="px-6 pt-3">
        <CodeEditor value={source} onChange={setSource} language="firestore-rules" height="50vh" markers={markers} label="Security Rules" />
      </div>
      <Section title="History" description="Publishing an older ruleset again is a rollback.">
        <ul className="m-0 list-none border-t border-rule p-0">
          {(state.data?.history ?? []).map((r) => (
            <li key={r.name} className="flex items-center gap-3 border-b border-rule px-6 py-1.5 text-dense">
              <span className="font-mono text-[12px] text-ink">{r.id}</span>
              <span className="text-meta text-ink-3">
                <Timestamp iso={r.createTime} />
              </span>
              {r.name === current?.name ? <span className="text-meta text-construct-ink">Published</span> : null}
              <span className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={EyeIcon}
                  onClick={async () => setViewing({ id: r.id, source: (await fetchRuleset(ctx.projectId, r.id)).source })}
                >
                  Compare
                </Button>
                {r.name !== current?.name ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={ArrowCounterClockwiseIcon}
                    disabled={!!ctx.readOnly}
                    onClick={async () => {
                      setSource((await fetchRuleset(ctx.projectId, r.id)).source);
                      setPublishing(true);
                    }}
                  >
                    Publish again
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Playground" description="Tests requests against the rules in the editor, without publishing them.">
        <Notes
          notes={[{ id: 'prod', tone: 'warn', text: 'get() and exists() in the rules read this database’s real documents during a test.' }]}
          title="Before you test"
        />
        <div className="flex flex-col gap-3 px-6 pt-3">
          {cases.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[8rem_minmax(0,1fr)_10rem_minmax(0,1fr)_auto] items-start gap-2">
              <Select<RulesTestCase['method']>
                value={c.method}
                onValueChange={(method) => setCases(cases.map((x) => (x.id === c.id ? { ...x, method } : x)))}
                aria-label={`Method of test ${i + 1}`}
                options={['get', 'list', 'create', 'update', 'delete'].map((m) => ({ value: m as RulesTestCase['method'], label: m }))}
              />
              <Input
                mono
                value={c.path}
                onChange={(e) => setCases(cases.map((x) => (x.id === c.id ? { ...x, path: e.target.value } : x)))}
                aria-label={`Path of test ${i + 1}`}
                placeholder="users/u1"
              />
              <Input
                mono
                value={c.uid}
                onChange={(e) => setCases(cases.map((x) => (x.id === c.id ? { ...x, uid: e.target.value } : x)))}
                aria-label={`User id of test ${i + 1}`}
                placeholder="Signed out"
              />
              <div className="flex flex-col gap-1">
                <Textarea
                  mono
                  rows={1}
                  value={c.claims}
                  onChange={(e) => setCases(cases.map((x) => (x.id === c.id ? { ...x, claims: e.target.value } : x)))}
                  aria-label={`Token claims of test ${i + 1}`}
                  disabled={!c.uid.trim()}
                />
                {c.method === 'create' || c.method === 'update' ? (
                  <Textarea
                    mono
                    rows={2}
                    value={c.data}
                    onChange={(e) => setCases(cases.map((x) => (x.id === c.id ? { ...x, data: e.target.value } : x)))}
                    aria-label={`Request data of test ${i + 1}`}
                  />
                ) : null}
              </div>
              <IconButton
                icon={XIcon}
                label={`Remove test ${i + 1}`}
                size="sm"
                onClick={() => setCases(cases.filter((x) => x.id !== c.id))}
                disabled={cases.length === 1}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={PlusIcon} onClick={() => setCases([...cases, newCase()])} disabled={cases.length >= 20}>
              Test
            </Button>
            <Button icon={PlayIcon} loading={testing} onClick={() => void runTests()}>
              Run tests
            </Button>
          </div>
          {results ? (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {results.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: result i belongs to test case i.
                <li key={`${i}:${r.state}`} className="border-t border-rule pt-2">
                  <div className="flex items-center gap-3 text-dense">
                    <span className="tnum font-mono text-[12px] text-ink-3">{i + 1}.</span>
                    {r.allowed ? <StatusGlyph kind="ok" label="Allowed" /> : <StatusGlyph kind="error" label="Denied" />}
                    <span className="font-mono text-[12px] text-ink-2">
                      {cases[i]?.method} /{cases[i]?.path}
                    </span>
                    {r.errorPosition ? <span className="text-meta text-redline-ink">Error at line {r.errorPosition.line}</span> : null}
                  </div>
                  {r.debugMessages.length > 0 ? (
                    <pre className="m-0 mt-1 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] text-ink-2">
                      {r.debugMessages.join('\n')}
                    </pre>
                  ) : null}
                  {r.evaluations.length > 0 ? (
                    <div className="mt-1">
                      <Legend>Evaluated</Legend>
                      <ul className="m-0 list-none p-0 font-mono text-[11px] text-ink-2">
                        {r.evaluations.slice(0, 20).map((e) => (
                          <li key={`${e.line}:${e.column}:${e.value}`}>
                            {e.line ? `line ${e.line}, column ${e.column}` : e.expression}: {e.value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Section>

      <Dialog
        open={publishing}
        onOpenChange={(o) => !busy && setPublishing(o)}
        title="Publish rules"
        description="Every client of this database follows the new rules within a minute."
        width="xl"
        footer={
          <>
            <Button onClick={() => setPublishing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="commit" icon={UploadSimpleIcon} loading={busy} onClick={() => void publish()}>
              Publish rules
            </Button>
          </>
        }
      >
        <DiffEditor
          original={current?.source ?? ''}
          modified={source}
          language="firestore-rules"
          height="55vh"
          label="Changes to the rules"
        />
      </Dialog>
      <Dialog
        open={viewing !== null}
        onOpenChange={(o) => !o && setViewing(null)}
        title={`Ruleset ${viewing?.id ?? ''} against the published rules`}
        width="xl"
      >
        {viewing ? (
          <DiffEditor
            original={current?.source ?? ''}
            modified={viewing.source}
            language="firestore-rules"
            height="60vh"
            label="Ruleset comparison"
          />
        ) : null}
      </Dialog>
    </div>
  );
}
