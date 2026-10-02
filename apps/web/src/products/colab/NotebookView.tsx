import type { NotebookCell, NotebookDocument, NotebookOutput } from '@nephoscope/contracts';
import { useState } from 'react';
import { Legend } from '../../design/Drafting';
import { Switch } from '../../design/Form';
import { bytes } from '../../lib/format';

/** Markdown is shown as text; heading lines keep their weight so the outline reads (SPEC-0010 D-06). */
function MarkdownText({ source }: { source: string }) {
  return (
    <div className="flex max-w-[80ch] flex-col gap-1 text-dense leading-6 text-ink">
      {source.split('\n').map((line, i) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const key = `${i}:${line.slice(0, 16)}`;
        if (heading) {
          const level = heading[1]?.length ?? 1;
          return (
            <p key={key} className={level <= 2 ? 'm-0 text-section font-semibold' : 'm-0 font-semibold'}>
              {heading[2]}
            </p>
          );
        }
        return line.trim() ? (
          <p key={key} className="m-0 whitespace-pre-wrap">
            {line}
          </p>
        ) : (
          <span key={key} className="h-1" aria-hidden />
        );
      })}
    </div>
  );
}

function Pre({ children, tone }: { children: string; tone?: 'error' | 'muted' }) {
  return (
    <pre
      className={
        tone === 'error'
          ? 'm-0 max-h-[32rem] overflow-auto font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-redline-ink'
          : tone === 'muted'
            ? 'm-0 max-h-[32rem] overflow-auto font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-ink-2'
            : 'm-0 max-h-[32rem] overflow-auto font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-ink'
      }
    >
      {children}
    </pre>
  );
}

/** HTML outputs are never rendered (SPEC-0001 D-22); their source is one click away. */
function HtmlOutput({ html, hasOther }: { html: string; hasOther: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta text-ink-3">
        HTML output, not rendered{hasOther ? '; the plain text above is the same result' : ''}.{' '}
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-ink-2 underline underline-offset-2 hover:text-ink">
          {open ? 'Hide source' : 'Show source'}
        </button>
      </span>
      {open ? <Pre tone="muted">{html}</Pre> : null}
    </div>
  );
}

function Output({ output, cell }: { output: NotebookOutput; cell: number }) {
  if (output.kind === 'stream') return <Pre tone={output.name === 'stderr' ? 'muted' : undefined}>{output.text}</Pre>;
  if (output.kind === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <Pre tone="error">{`${output.name}: ${output.value}`}</Pre>
        {output.traceback ? <Pre tone="muted">{output.traceback}</Pre> : null}
      </div>
    );
  }
  const shown = output.image || output.text !== null || output.markdown !== null || output.json !== null;
  return (
    <div className="flex flex-col gap-2">
      {output.image ? (
        <img
          src={`data:${output.image.mime};base64,${output.image.data}`}
          alt={`Output of cell ${cell}`}
          className="max-h-[36rem] max-w-full self-start rounded-control border border-rule bg-sheet object-contain"
        />
      ) : null}
      {output.markdown !== null && !output.image ? <MarkdownText source={output.markdown} /> : null}
      {output.json !== null && output.markdown === null && !output.image ? <Pre>{output.json}</Pre> : null}
      {output.text !== null && !output.image && output.markdown === null && output.json === null ? <Pre>{output.text}</Pre> : null}
      {output.html !== null ? <HtmlOutput html={output.html} hasOther={!!shown} /> : null}
      {output.omitted.length > 0 && !shown && output.html === null ? (
        <span className="text-meta text-ink-3">Output of type {output.omitted.join(', ')}, which Nephoscope does not show.</span>
      ) : null}
    </div>
  );
}

function Cell({ cell, outputs }: { cell: NotebookCell; outputs: boolean }) {
  const label = `Cell ${cell.index + 1}, ${cell.type}`;
  return (
    <section aria-label={label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 last:border-b-0">
      <span className="tnum pt-1 text-right font-mono text-[11px] text-ink-3" aria-hidden>
        {cell.type === 'code' ? `[${cell.executionCount ?? ' '}]` : cell.type === 'raw' ? 'raw' : ''}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        {cell.type === 'markdown' ? (
          <MarkdownText source={cell.source} />
        ) : (
          <div className="rounded-control bg-well px-3 py-2">
            <Pre>{cell.source || ' '}</Pre>
          </div>
        )}
        {outputs && cell.outputs.length > 0 ? (
          <div className="flex flex-col gap-2 border-l-2 border-rule pl-3">
            {cell.outputs.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: outputs have no identity and never reorder.
              <Output key={i} output={o} cell={cell.index + 1} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A read-only view of a notebook: cells and outputs, as text and images only (SPEC-0010 D-06). */
export function NotebookView({ doc, caption }: { doc: NotebookDocument; caption?: string }) {
  const [outputs, setOutputs] = useState(true);
  const nb = doc.notebook;
  if (!nb) return <p className="m-0 px-6 py-6 text-dense text-ink-2">{doc.error ?? 'The notebook cannot be shown.'}</p>;
  const code = nb.cells.filter((c) => c.type === 'code').length;
  const withOutput = nb.cells.filter((c) => c.outputs.length > 0).length;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule px-6 py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {[
            ['File', caption ?? doc.path],
            ['Kernel', nb.kernel ?? 'Not set'],
            ['Cells', `${nb.cells.length} (${code} code)`],
            ['Size', bytes(doc.size)],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <Legend>{k}</Legend>
              <span className="font-mono text-[12px] text-ink">{v}</span>
            </div>
          ))}
        </div>
        {withOutput > 0 ? (
          <div className="w-56">
            <Switch checked={outputs} onCheckedChange={setOutputs} label="Show outputs" description={`${withOutput} cells have outputs`} />
          </div>
        ) : null}
      </div>
      <div className="px-6">
        {nb.cells.length === 0 ? (
          <p className="m-0 py-6 text-dense text-ink-2">The notebook has no cells.</p>
        ) : (
          nb.cells.map((c) => <Cell key={c.index} cell={c} outputs={outputs} />)
        )}
      </div>
    </div>
  );
}
