import type { StorageObject } from '@nephoscope/contracts';
import {
  PREVIEW_CSV_ROWS,
  PREVIEW_IMAGE_MAX,
  PREVIEW_TEXT_MAX,
  type PreviewKind,
  previewKind,
} from '@nephoscope/contracts/storage-preview';
import { useQuery } from '@tanstack/react-query';
import { DelayedSkeleton } from '../../design/Feedback';
import { JsonTree } from '../../design/JsonTree';
import { ApiError } from '../../lib/api';
import { bytes } from '../../lib/format';
import { objectLink } from './api';

/** A minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if ((field !== '' || row.length > 0) && rows.length < maxRows) rows.push([...row, field]);
  return rows;
}

const TEXT_KINDS: PreviewKind[] = ['text', 'json', 'csv', 'source'];

/**
 * Inline previews that never run what they show (SPEC-0006 D-12, SPEC-0001 CA-73): media streams
 * through a short-lived link with range requests; text is read up to 5 MiB and rendered as text.
 */
export function Preview({ projectId, bucket, object }: { projectId: string; bucket: string; object: StorageObject }) {
  const kind = previewKind(object.contentType, object.name);
  const size = Number(object.size);
  const tooBig = kind === 'image' && size > PREVIEW_IMAGE_MAX;
  const link = useQuery({
    queryKey: ['storage-link', projectId, bucket, object.name, object.generation],
    queryFn: () => objectLink(projectId, bucket, { name: object.name, generation: object.generation, disposition: 'inline' }),
    enabled: !!kind && !tooBig && size > 0,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
  });
  const isText = !!kind && TEXT_KINDS.includes(kind);
  const text = useQuery({
    queryKey: ['storage-text', link.data?.url],
    queryFn: async ({ signal }) => {
      const res = await fetch(link.data?.url ?? '', { signal, headers: { range: `bytes=0-${PREVIEW_TEXT_MAX - 1}` } });
      if (!res.ok) throw new Error(`The object could not be read (${res.status}).`);
      return res.text();
    },
    enabled: isText && !!link.data?.url,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!kind)
    return (
      <p className="m-0 text-meta text-ink-3">
        No preview for {object.contentType ? <span className="font-mono">{object.contentType}</span> : 'this type'}: download it instead.
      </p>
    );
  if (size === 0) return <p className="m-0 text-meta text-ink-3">The object is empty.</p>;
  if (tooBig)
    return <p className="m-0 text-meta text-ink-3">Images over {bytes(PREVIEW_IMAGE_MAX)} are not previewed: download it instead.</p>;
  if (link.error)
    return <p className="m-0 text-meta text-redline-ink">{link.error instanceof ApiError ? link.error.problem.detail : 'No preview.'}</p>;
  if (!link.data) return <DelayedSkeleton rows={4} />;
  const url = link.data.url;
  const label = `Preview of ${object.name}`;
  switch (kind) {
    case 'image':
      return (
        <div className="flex justify-center rounded-control border border-rule bg-well p-2">
          <img src={url} alt={label} className="max-h-[60vh] max-w-full object-contain" />
        </div>
      );
    case 'pdf':
      return <iframe src={url} title={label} className="h-[70vh] w-full rounded-control border border-rule bg-well" />;
    case 'audio':
      // biome-ignore lint/a11y/useMediaCaption: stored audio has no caption track to offer.
      return <audio src={url} controls preload="metadata" className="w-full" aria-label={label} />;
    case 'video':
      return (
        // biome-ignore lint/a11y/useMediaCaption: stored video has no caption track to offer.
        <video src={url} controls preload="metadata" className="max-h-[60vh] w-full rounded-control bg-well" aria-label={label} />
      );
  }
  if (text.isPending) return <DelayedSkeleton rows={4} />;
  if (text.error) return <p className="m-0 text-meta text-redline-ink">{text.error.message}</p>;
  const body = text.data ?? '';
  const truncated = size > PREVIEW_TEXT_MAX;
  const note = truncated ? (
    <p className="m-0 mb-1 text-meta text-ink-3">
      Showing the first {bytes(PREVIEW_TEXT_MAX)} of {bytes(size)}.
    </p>
  ) : null;
  if (kind === 'json' && !truncated) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined) return <JsonTree value={parsed} label={label} height={420} />;
  }
  if (kind === 'csv') {
    const rows = parseCsv(body, PREVIEW_CSV_ROWS + 1);
    const [head, ...rest] = rows;
    const shown = rest.slice(0, PREVIEW_CSV_ROWS - 1);
    return (
      <div>
        {note}
        {rows.length > PREVIEW_CSV_ROWS ? (
          <p className="m-0 mb-1 text-meta text-ink-3">Showing the first {PREVIEW_CSV_ROWS.toLocaleString('en-US')} rows.</p>
        ) : null}
        <div className="max-h-[60vh] overflow-auto rounded-control border border-rule">
          <table className="w-full border-collapse text-dense">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {(head ?? []).map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                  <th key={i} scope="col" className="border-b border-rule px-2 py-1 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <tr key={i} className="border-b border-rule">
                  {r.map((c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                    <td key={j} className="px-2 py-1 font-mono text-[12px] whitespace-pre">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <div>
      {note}
      {kind === 'source' ? <p className="m-0 mb-1 text-meta text-ink-3">HTML, SVG and XML are shown as source, never rendered.</p> : null}
      <pre className="m-0 max-h-[60vh] overflow-auto rounded-control border border-rule bg-well p-2 font-mono text-[12px] whitespace-pre-wrap text-ink">
        {body}
      </pre>
    </div>
  );
}
