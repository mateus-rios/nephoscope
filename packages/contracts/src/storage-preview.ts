/** Cloud Storage values the browser needs (SPEC-0006 D-10, D-12). Zod-free: imported through @nephoscope/contracts/storage-preview. */

export const storageClasses = ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'] as const;
export type StorageClass = (typeof storageClasses)[number];

export type PreviewKind = 'image' | 'text' | 'json' | 'csv' | 'pdf' | 'audio' | 'video' | 'source';

const RASTER: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};
const MEDIA: Record<string, string> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * How an object may be previewed (D-12), or null when it only downloads (SPEC-0001 CA-73).
 * "source" is HTML, SVG or XML: never rendered, only shown as text.
 */
export function previewKind(contentType: string | null | undefined, name: string): PreviewKind | null {
  const t = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (t === 'image/svg+xml' || t.includes('html') || t.includes('xml') || ['html', 'htm', 'xhtml', 'xml', 'svg'].includes(ext))
    return 'source';
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(t) || (!t.startsWith('image/') && ext in RASTER)) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (t.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (t === 'application/json' || t.endsWith('+json') || ['json', 'ndjson', 'jsonl'].includes(ext)) return 'json';
  if (t === 'text/csv' || ext === 'csv') return 'csv';
  if (
    t.startsWith('text/') ||
    ['txt', 'log', 'md', 'yaml', 'yml', 'ini', 'toml', 'sql', 'sh', 'js', 'ts', 'py', 'go', 'java', 'env'].includes(ext)
  )
    return 'text';
  return null;
}

/**
 * The media type a preview is served with: the stored type for raster images and media (or one
 * derived from the extension), plain text for everything else, so nothing stored can run.
 */
export function servedType(kind: PreviewKind, contentType: string | null | undefined, name: string): string {
  const t = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (kind === 'image') return /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(t) ? t : (RASTER[ext] ?? 'application/octet-stream');
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'audio' || kind === 'video') return t.startsWith(`${kind}/`) ? t : (MEDIA[ext] ?? 'application/octet-stream');
  return 'text/plain; charset=utf-8';
}

/** Size limits of inline previews (D-12). */
export const PREVIEW_TEXT_MAX = 5 * 1024 * 1024;
export const PREVIEW_IMAGE_MAX = 50 * 1024 * 1024;
/** CSV previews show this many rows as a table. */
export const PREVIEW_CSV_ROWS = 1000;
