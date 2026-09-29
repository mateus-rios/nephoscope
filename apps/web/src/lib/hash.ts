/** FNV-1a 32-bit: small, stable, good enough to pick a profile mark shape (SPEC-0002 D-19). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Two-letter initials from a principal such as `deploy-bot@acme.iam.gserviceaccount.com`. */
export function initialsOf(principal: string | null | undefined, fallback: string): string {
  const source = (principal ?? '').split('@')[0] || fallback;
  const parts = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : (parts[0] ?? fallback).slice(0, 2);
  return letters.toUpperCase().padEnd(2, '·');
}
