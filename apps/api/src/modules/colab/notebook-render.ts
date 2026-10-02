import type { NotebookCell, NotebookOutput, RenderedNotebook } from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: notebook JSON is untrusted and read field by field.
type Any = any;

/** Longest text kept per cell source or output; the rest is cut with a marker. */
export const TEXT_CAP = 512 * 1024;

const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const SHOWN = new Set([...RASTER, 'image/svg+xml', 'text/plain', 'text/html', 'text/markdown', 'application/json']);
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');

/** nbformat stores multiline strings as a string or an array of lines. */
function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : '')).join('');
  return '';
}

function cap(s: string): string {
  return s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}\n[${(s.length - TEXT_CAP).toLocaleString('en')} more characters not shown]` : s;
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function image(data: Record<string, unknown>): { mime: string; data: string } | null {
  for (const mime of RASTER) {
    const v = text(data[mime]).replace(/\s+/g, '');
    if (v && /^[A-Za-z0-9+/]+=*$/.test(v)) return { mime, data: v };
  }
  const svg = text(data['image/svg+xml']);
  // SVG is only ever shown through <img>, which runs no scripts (SPEC-0001 D-22).
  return svg ? { mime: 'image/svg+xml', data: Buffer.from(svg, 'utf8').toString('base64') } : null;
}

function output(o: Any): NotebookOutput | null {
  if (!o || typeof o !== 'object') return null;
  switch (o.output_type) {
    case 'stream':
      return { kind: 'stream', name: typeof o.name === 'string' ? o.name : 'stdout', text: cap(text(o.text)) };
    case 'error':
      return {
        kind: 'error',
        name: typeof o.ename === 'string' ? o.ename : 'Error',
        value: cap(typeof o.evalue === 'string' ? o.evalue : ''),
        traceback: cap((Array.isArray(o.traceback) ? o.traceback.map(String).join('\n') : '').replace(ANSI, '')),
      };
    case 'execute_result':
    case 'display_data':
    case 'update_display_data': {
      const data: Record<string, unknown> = o.data && typeof o.data === 'object' ? o.data : {};
      const json = data['application/json'];
      return {
        kind: 'result',
        executionCount: count(o.execution_count),
        text: data['text/plain'] !== undefined ? cap(text(data['text/plain'])) : null,
        image: image(data),
        html: data['text/html'] !== undefined ? cap(text(data['text/html'])) : null,
        markdown: data['text/markdown'] !== undefined ? cap(text(data['text/markdown'])) : null,
        json: json !== undefined ? cap(JSON.stringify(json, null, 2)) : null,
        omitted: Object.keys(data)
          .filter((k) => !SHOWN.has(k))
          .sort(),
      };
    }
    default:
      return null;
  }
}

function cell(c: Any, index: number): NotebookCell {
  const type = c?.cell_type === 'markdown' ? 'markdown' : c?.cell_type === 'raw' ? 'raw' : 'code';
  return {
    index,
    type,
    source: cap(text(c?.source)),
    executionCount: type === 'code' ? count(c?.execution_count) : null,
    outputs: type === 'code' && Array.isArray(c?.outputs) ? c.outputs.map(output).filter((o: NotebookOutput | null) => o !== null) : [],
  };
}

/**
 * Reads a Jupyter notebook (nbformat 4) into the shape the viewer draws. Nothing in it is ever
 * rendered as markup: HTML outputs travel as source text (SPEC-0001 D-22, SPEC-0010 D-06).
 */
export function renderNotebook(source: string): { notebook: RenderedNotebook | null; error: string | null } {
  let nb: Any;
  try {
    nb = JSON.parse(source);
  } catch {
    return { notebook: null, error: 'The file is not valid JSON, so it cannot be shown as a notebook.' };
  }
  if (!nb || typeof nb !== 'object' || Array.isArray(nb)) return { notebook: null, error: 'The file is not a Jupyter notebook.' };
  if (!Array.isArray(nb.cells)) {
    return {
      notebook: null,
      error: Array.isArray(nb.worksheets)
        ? 'This notebook uses nbformat 3, which Nephoscope does not show. Download it instead.'
        : 'The file has no cells, so it is not a Jupyter notebook.',
    };
  }
  const meta = nb.metadata && typeof nb.metadata === 'object' ? nb.metadata : {};
  return {
    notebook: {
      nbformat: `${count(nb.nbformat) ?? '?'}.${count(nb.nbformat_minor) ?? 0}`,
      kernel: typeof meta.kernelspec?.display_name === 'string' ? meta.kernelspec.display_name : (meta.kernelspec?.name ?? null),
      language: typeof meta.language_info?.name === 'string' ? meta.language_info.name : null,
      cells: nb.cells.map(cell),
    },
    error: null,
  };
}

/** Checks text sent as a new notebook version before it is committed (SPEC-0010 D-05). */
export function validateNotebook(source: string): string | null {
  const { error } = renderNotebook(source);
  return error;
}

/** A notebook with one empty code cell, for "Create notebook" without a file. */
export function emptyNotebook(): string {
  return `${JSON.stringify(
    {
      nbformat: 4,
      nbformat_minor: 0,
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
      cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [] }],
    },
    null,
    1,
  )}\n`;
}
