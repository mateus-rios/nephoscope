import type { RoleSummary } from '@nephoscope/contracts';
import { useEffect, useState } from 'react';
import { DelayedSkeleton } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { ApiError } from '../../lib/api';
import { useRoleSearch } from './api';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Searches predefined and custom roles, with each role's description and size (SPEC-0007 D-01). */
export function RolePicker({
  projectId,
  onPick,
  label = 'Role',
}: {
  projectId: string;
  onPick: (role: RoleSummary) => void;
  label?: string;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const roles = useRoleSearch(projectId, { q }, q.length >= 2);
  return (
    <div className="flex flex-col gap-1">
      <Field label={label} help="Type part of a name or title, such as run invoker.">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search roles" />
      </Field>
      {q.length >= 2 ? (
        <div role="listbox" aria-label="Roles" className="max-h-64 overflow-y-auto rounded-control border border-rule">
          {roles.isPending ? (
            <DelayedSkeleton rows={3} className="p-2" />
          ) : roles.error instanceof ApiError ? (
            <p className="m-0 p-2 text-meta text-redline-ink">{roles.error.problem.detail}</p>
          ) : (roles.data ?? []).length === 0 ? (
            <p className="m-0 p-2 text-meta text-ink-3">No role matches.</p>
          ) : (
            (roles.data ?? []).slice(0, 60).map((r) => (
              <button
                key={r.name}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(r);
                  setText('');
                }}
                className="block w-full border-b border-rule px-2 py-1 text-left last:border-b-0 hover:bg-hover"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-dense text-ink">{r.title}</span>
                  <span className="tnum shrink-0 text-meta text-ink-2">{r.permissionCount} permissions</span>
                </span>
                <span className="block truncate font-mono text-[11px] text-ink-2">{r.name}</span>
                {r.description ? <span className="block truncate text-meta text-ink-2">{r.description}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
