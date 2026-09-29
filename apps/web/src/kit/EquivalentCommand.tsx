import { useState } from 'react';
import { Legend } from '../design/Drafting';
import { CopyButton } from '../design/Values';
import { cn } from '../lib/cn';

export interface Equivalent {
  gcloud?: string | null;
  rest?: { method: string; url: string; body?: unknown } | null;
}

/** Quotes a shell argument only when it needs it. */
export function sh(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Puts each top-level flag of a long one-line command on its own continued line, so the command
 * reads like a script and wraps only between flags. Quoted text is never split.
 */
export function wrapFlags(command: string, width = 80): string {
  if (command.includes('\n') || command.length <= width) return command;
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === ' ' && command.startsWith('--', i + 1)) {
      parts.push(command.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(command.slice(start).trim());
  return parts.filter(Boolean).join(' \\\n  ');
}

function restText(rest: NonNullable<Equivalent['rest']>): string {
  const lines = [`${rest.method} ${rest.url}`];
  if (rest.body !== undefined) lines.push('', JSON.stringify(rest.body, null, 2));
  return lines.join('\n');
}

/** "Equivalent command": the gcloud command and REST call matching a form (SPEC-0001 CA-65). */
export function EquivalentCommand({ gcloud, rest }: Equivalent) {
  const options = [gcloud ? ('gcloud' as const) : null, rest ? ('rest' as const) : null].filter(Boolean) as ('gcloud' | 'rest')[];
  const [tab, setTab] = useState<'gcloud' | 'rest'>(options[0] ?? 'gcloud');
  if (options.length === 0) return null;
  const text = tab === 'gcloud' ? wrapFlags(gcloud ?? '') : rest ? restText(rest) : '';
  return (
    <section aria-label="Equivalent command" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <Legend>Equivalent command</Legend>
        <span className="flex gap-2">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={tab === o}
              onClick={() => setTab(o)}
              className={cn('text-meta', tab === o ? 'font-medium text-ink underline underline-offset-4' : 'text-ink-3 hover:text-ink')}
            >
              {o === 'gcloud' ? 'gcloud' : 'REST'}
            </button>
          ))}
        </span>
        <span className="ml-auto">
          <CopyButton value={text} label="Copy command" />
        </span>
      </div>
      <pre className="m-0 max-h-60 overflow-auto rounded-control bg-well p-3 font-mono text-[11px] leading-5 whitespace-pre text-ink">
        {text}
      </pre>
    </section>
  );
}
