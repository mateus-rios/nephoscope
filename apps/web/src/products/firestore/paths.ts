/** Firestore paths from the database root, such as users/abc/orders (SPEC-0004 D-04). */

export const segmentsOf = (path: string): string[] => (path ? path.split('/').filter(Boolean) : []);
export const isDocumentPath = (path: string) => segmentsOf(path).length > 0 && segmentsOf(path).length % 2 === 0;
export const isCollectionPath = (path: string) => segmentsOf(path).length % 2 === 1;

/** The collection holding a document. */
export const parentCollection = (docPath: string) => segmentsOf(docPath).slice(0, -1).join('/');

/** The document holding a collection; empty for root collections. */
export const parentDocument = (collectionPath: string) => segmentsOf(collectionPath).slice(0, -1).join('/');

export const lastSegment = (path: string) => segmentsOf(path).at(-1) ?? '';

/** Normalizes what someone typed in the path bar: slashes trimmed, empty segments dropped. */
export function normalizePath(input: string): string {
  return segmentsOf(input.trim()).join('/');
}

/** Splits a document reference into its database and path. */
export function parseReference(name: string): { projectId: string; databaseId: string; path: string } | null {
  const m = /^projects\/([^/]+)\/databases\/([^/]+)\/documents\/(.+)$/.exec(name);
  if (!m) return null;
  return { projectId: m[1] ?? '', databaseId: m[2] ?? '', path: m[3] ?? '' };
}

export function databaseHref(projectId: string, databaseId: string, tab = 'data', search: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...(tab !== 'data' ? { tab } : {}), ...search }).toString();
  return `/p/${projectId}/firestore/${encodeURIComponent(databaseId)}${params ? `?${params}` : ''}`;
}
