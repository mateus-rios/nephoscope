import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * View state kept in the URL search params (SPEC-0001 CA-61): tabs, filters and ranges survive a
 * reload, back and forward, and shared links. The default value is left out of the URL.
 */
export function useSearchState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = search[key];
  const value = typeof raw === 'string' && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) => {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, [key]: next === fallback ? undefined : next }),
        replace: true,
      } as never);
    },
    [navigate, key, fallback],
  );
  return [value, set];
}

/** Accepts any search params; product routes read theirs with useSearchState. */
export function passthroughSearch(search: Record<string, unknown>): Record<string, unknown> {
  return search;
}
