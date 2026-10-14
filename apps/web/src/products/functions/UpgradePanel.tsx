import type { CloudFunction, FunctionUpgradeView, OperationAccepted, UpgradeStep } from '@nephoscope/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { StatusGlyph } from '../../design/Status';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ApiError, api } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2/';
const METHOD: Record<UpgradeStep, string> = {
  setup: 'setupFunctionUpgradeConfig',
  redirect: 'redirectFunctionUpgradeTraffic',
  rollback: 'rollbackFunctionUpgradeTraffic',
  commit: 'commitFunctionUpgrade',
  abort: 'abortFunctionUpgrade',
};
const STEP_LABEL: Record<UpgradeStep, string> = {
  setup: 'Set up the 2nd gen copy',
  redirect: 'Send traffic to the copy',
  rollback: 'Send traffic back to 1st gen',
  commit: 'Commit the upgrade',
  abort: 'Abort the upgrade',
};
const STEP_HELP: Record<UpgradeStep, string> = {
  setup: 'Builds a 2nd gen copy of the function next to it. Traffic does not move yet.',
  redirect: 'Requests go to the copy. The 1st gen function stays, so this can be undone.',
  rollback: 'Requests go back to the 1st gen function. The copy stays for another try.',
  commit: 'The copy becomes the function and the 1st gen function is deleted. This cannot be undone.',
  abort: 'The copy is deleted and the function stays 1st gen.',
};
const SEQUENCE: UpgradeStep[] = ['setup', 'redirect', 'commit'];

function done(state: string | null, step: UpgradeStep): boolean {
  if (!state) return false;
  if (step === 'setup') return /^(SETUP_FUNCTION_UPGRADE_CONFIG_SUCCESSFUL|REDIRECT|ROLLBACK|COMMIT)/.test(state);
  if (step === 'redirect')
    return /^(REDIRECT_FUNCTION_UPGRADE_TRAFFIC_SUCCESSFUL|ROLLBACK_FUNCTION_UPGRADE_TRAFFIC_ERROR|COMMIT)/.test(state);
  return false;
}

/** The guided upgrade of a 1st gen function to Cloud Run functions (SPEC-0003 D-18). */
export function UpgradePanel({ projectId, fn, readOnly }: { projectId: string; fn: CloudFunction; readOnly: string | null }) {
  const profileId = useSession((s) => s.profileId);
  const path = `/api/projects/${enc(projectId)}/functions/locations/${enc(fn.location)}/functions/${enc(fn.id)}`;
  const q = useQuery({
    queryKey: ['functions', profileId, projectId, 'upgrade', fn.location, fn.id],
    queryFn: ({ signal }) => api<FunctionUpgradeView>(`${path}/upgrade`, { signal }),
    enabled: !!profileId,
  });
  const [sa, setSa] = useState('');
  const [busy, setBusy] = useState<UpgradeStep | null>(null);
  const [confirming, setConfirming] = useState<UpgradeStep | null>(null);

  async function run(step: UpgradeStep, confirm?: string) {
    setBusy(step);
    try {
      const { operation } = await api<OperationAccepted>(`${path}/upgrade/${step}`, {
        body: { ...(step === 'setup' && sa.trim() ? { triggerServiceAccount: sa.trim() } : {}), ...(confirm ? { confirm } : {}) },
      });
      useOperations.getState().upsert(operation);
      toast(`${STEP_LABEL[step]}: started`, { description: 'Follow it in the operations tray. The state below updates when it ends.' });
      void q.refetch();
    } catch (err) {
      toast.error(`${STEP_LABEL[step]} failed`, {
        description: err instanceof ApiError ? err.problem.detail : String(err),
        duration: 10_000,
      });
      if (confirm) throw err;
    } finally {
      setBusy(null);
    }
  }

  if (q.isPending) return <DelayedSkeleton rows={4} className="p-6" />;
  if (q.error instanceof ApiError) return <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />;
  const v = q.data;
  if (!v) return null;
  const name = `projects/${projectId}/locations/${fn.location}/functions/${fn.id}`;
  const copyId = v.copyService?.split('/').pop() ?? null;
  const error = v.state?.includes('ERROR') ?? false;
  return (
    <Section
      title="Upgrade to Cloud Run functions"
      description="Each step is its own operation. Traffic moves only when you send it, and can be sent back until you commit."
    >
      <div className="flex flex-col gap-4 px-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusGlyph
            kind={error ? 'error' : v.state === 'UPGRADE_OPERATION_IN_PROGRESS' ? 'running' : 'ok'}
            label={(v.state ?? 'not 1st gen').toLowerCase().replaceAll('_', ' ')}
          />
          <span className="text-dense text-ink" aria-live="polite">
            {v.traffic}
          </span>
        </div>
        <ol aria-label="Upgrade steps" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {SEQUENCE.map((s, i) => (
            <li key={s} className="flex items-center gap-2 rounded-control border border-rule-strong px-3 py-1.5">
              <span className="font-mono text-[11px] text-ink-3">{i + 1}</span>
              <span className="text-dense text-ink">{STEP_LABEL[s]}</span>
              {done(v.state, s) ? <StatusGlyph kind="ok" label="Done" compact /> : null}
            </li>
          ))}
        </ol>
        {copyId ? (
          <p className="m-0 text-dense text-ink-2">
            The 2nd gen copy runs as the Cloud Run service{' '}
            <Link to={`/p/${projectId}/run/services/${fn.location}/${copyId}` as string} className="underline">
              {copyId}
            </Link>
            .
          </p>
        ) : null}
        {v.blocked ? <p className="m-0 text-dense text-ink-2">{v.blocked}</p> : null}
        {v.steps.includes('setup') && fn.trigger.kind === 'event' ? (
          <Field
            label="Trigger service account (optional)"
            help="The account the new Eventarc trigger uses. Empty uses the default compute service account."
            className="max-w-xl"
          >
            <Input value={sa} onChange={(e) => setSa(e.target.value)} mono />
          </Field>
        ) : null}
        <div className="flex flex-col gap-3">
          {/* The usual next step is the one commit; the others stay secondary (SPEC-0002 D-18). */}
          {v.steps.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-3">
              <Button
                variant={s !== v.steps[0] ? 'secondary' : s === 'commit' || s === 'abort' ? 'danger' : 'commit'}
                loading={busy === s}
                disabled={!!readOnly || busy !== null}
                disabledReason={readOnly ?? 'Another step is starting'}
                onClick={() => (s === 'commit' || s === 'abort' ? setConfirming(s) : void run(s))}
              >
                {STEP_LABEL[s]}
              </Button>
              <span className="text-meta text-ink-2">{STEP_HELP[s]}</span>
            </div>
          ))}
        </div>
        {v.steps[0] ? (
          <EquivalentCommand
            rest={{
              method: 'POST',
              url: `${FUNCTIONS}${name}:${METHOD[v.steps[0]]}`,
              body: v.steps[0] === 'setup' && sa.trim() ? { triggerServiceAccount: sa.trim() } : {},
            }}
          />
        ) : null}
      </div>
      <ConfirmDestructive
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? STEP_LABEL[confirming] : ''}
        consequence={confirming ? STEP_HELP[confirming] : ''}
        expected={fn.id}
        confirmLabel={confirming ? STEP_LABEL[confirming] : ''}
        onConfirm={async (confirm) => {
          if (confirming) await run(confirming, confirm);
        }}
      />
    </Section>
  );
}
