import type { ListResponse } from '@nephoscope/contracts';
import { toProblem } from '../problem/google-error.mapper.js';

/**
 * Lists every location in parallel and merges the results (SPEC-0001 D-17). Failing locations
 * are reported in `unreachable` instead of failing the whole list. When every location fails
 * with the same kind of error (the API is disabled, the key lacks access), that error is thrown.
 */
export async function fanOut<T>(
  locations: readonly string[],
  list: (location: string) => Promise<T[]>,
  concurrency = 8,
): Promise<ListResponse<T>> {
  const items: T[] = [];
  const unreachable: string[] = [];
  const errors: unknown[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < locations.length) {
      const location = locations[next++] as string;
      try {
        items.push(...(await list(location)));
      } catch (err) {
        unreachable.push(location);
        errors.push(err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, locations.length) }, worker));
  if (locations.length > 0 && unreachable.length === locations.length) {
    // Nothing answered: surface the first error rather than an empty, misleading list.
    throw errors[0];
  }
  return { items, nextPageToken: null, unreachable: unreachable.sort() };
}

/**
 * Remembers, per API, whether `locations/-` works, so a rejected wildcard costs one call per
 * process instead of one per page load (SPEC-0001 D-17).
 */
export class WildcardSupport {
  private readonly known = new Map<string, boolean>();

  async list<T>(
    api: string,
    wildcard: () => Promise<ListResponse<T>>,
    perLocation: () => Promise<ListResponse<T>>,
  ): Promise<ListResponse<T>> {
    if (this.known.get(api) === false) return perLocation();
    try {
      const result = await wildcard();
      this.known.set(api, true);
      return result;
    } catch (err) {
      const problem = toProblem(err);
      // Only an argument or not-found error means the wildcard itself is unsupported.
      if (problem.code === 'INVALID_ARGUMENT' || problem.code === 'NOT_FOUND') {
        this.known.set(api, false);
        return perLocation();
      }
      throw err;
    }
  }
}
