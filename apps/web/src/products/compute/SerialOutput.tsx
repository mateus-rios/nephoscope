import type { SerialMessage } from '@nephoscope/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design/Button';
import { live } from '../../lib/live';
import { useSession } from '../../state/session';
import type { KitTabProps } from '../kit/tabs';

const KEEP = 1_000_000;

/** Serial port 1 of a VM, followed live on `compute.serial` (SPEC-0008 D-07, T-09). */
export function SerialOutput({ projectId, item }: KitTabProps) {
  const profileId = useSession((s) => s.profileId);
  const zone = item._location;
  const instance = String(item.name ?? '');
  const [text, setText] = useState('');
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!profileId || !follow) return;
    setError(null);
    return live.subscribe(
      'compute.serial',
      { profileId, projectId },
      { zone, instance },
      {
        data(payload) {
          const m = payload as SerialMessage;
          if (m.skipped) setSkipped((s) => s + m.skipped);
          if (m.text) setText((t) => (t + m.text).slice(-KEEP));
        },
        error(p) {
          setError(p.detail);
        },
      },
    );
  }, [profileId, projectId, zone, instance, follow]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new output is the trigger; the effect reads the DOM.
  useEffect(() => {
    const el = pre.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div className="flex flex-col gap-2 px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="text-meta text-ink-2" aria-live="polite">
          {error ? (
            <span className="text-redline-ink">{error}</span>
          ) : follow ? (
            'Following port 1; new output appears every few seconds.'
          ) : (
            'Paused.'
          )}
          {skipped > 0 ? ` ${skipped.toLocaleString()} bytes were dropped by Google before they could be read.` : ''}
        </span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setFollow((f) => !f)}>
            {follow ? 'Pause' : 'Follow'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setText('')}>
            Clear
          </Button>
        </span>
      </div>
      {/* Console output is project data: text only (SPEC-0001 D-22). */}
      <pre
        ref={pre}
        role="log"
        aria-label={`Serial output of ${instance}`}
        className="m-0 h-[60vh] overflow-auto rounded-control bg-well p-3 font-mono text-[12px] whitespace-pre-wrap text-ink"
      >
        {text || 'No output yet.'}
      </pre>
    </div>
  );
}
