import {
  type FunctionSource,
  MAX_SOURCE_ARCHIVE_BYTES,
  MAX_SOURCE_TEXT_BYTES,
  type RedeploySource,
  type SourceFile,
} from '@nephoscope/contracts';
import { unzipSync, zipSync } from 'fflate';
import { ProblemException } from '../../core/problem/problem.js';

/** Binary when a NUL byte appears early or the bytes are not valid UTF-8. */
export function isBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 64 * 1024));
    return false;
  } catch {
    return true;
  }
}

/** The files of a source archive, text where possible (SPEC-0003 D-09). */
export function readArchive(zip: Uint8Array): FunctionSource {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw ProblemException.of('FAILED_PRECONDITION', 'The source archive could not be read as a zip file.');
  }
  const files: SourceFile[] = [];
  let skipped = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue;
    const binary = isBinary(bytes);
    const tooLarge = bytes.byteLength > MAX_SOURCE_TEXT_BYTES;
    if (!binary && tooLarge) skipped++;
    files.push({ path, size: bytes.byteLength, binary, text: binary || tooLarge ? null : new TextDecoder().decode(bytes) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    archiveBytes: zip.byteLength,
    note: skipped > 0 ? `${skipped} text ${skipped === 1 ? 'file is' : 'files are'} over 2 MiB and shown without content.` : null,
  };
}

/** The current archive with edited, added and deleted files applied (SPEC-0003 CA-17). */
export function patchArchive(zip: Uint8Array, patch: RedeploySource): Uint8Array {
  const entries = unzipSync(zip);
  for (const path of patch.deleted) delete entries[path];
  const encoder = new TextEncoder();
  for (const { path, content } of patch.changed) entries[path] = encoder.encode(content);
  const files = Object.fromEntries(Object.entries(entries).filter(([p]) => !p.endsWith('/')));
  const out = zipSync(files, { level: 6 });
  if (out.byteLength > MAX_SOURCE_ARCHIVE_BYTES) throw ProblemException.of('INVALID_ARGUMENT', 'The new archive would exceed 100 MiB.');
  return out;
}

/** Downloads from a signed URL, refusing archives over the limit. */
export async function fetchArchive(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok)
    throw ProblemException.of('UNAVAILABLE', `The source archive could not be downloaded (HTTP ${res.status}).`, { retryable: true });
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_SOURCE_ARCHIVE_BYTES) throw ProblemException.of('FAILED_PRECONDITION', 'The source archive is larger than 100 MiB.');
  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength > MAX_SOURCE_ARCHIVE_BYTES)
    throw ProblemException.of('FAILED_PRECONDITION', 'The source archive is larger than 100 MiB.');
  return buffer;
}
