import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';

interface ViewScopeValue {
  register(label: string): () => void;
}

const ViewScopeContext = createContext<ViewScopeValue | null>(null);

/**
 * A view: a page, a dialog or a sheet. Each view may mount at most one commit control
 * (SPEC-0002 D-18); development builds warn when a second one appears.
 */
export function ViewScope({ name, children }: { name: string; children: ReactNode }) {
  const mounted = useRef(new Map<number, string>());
  const counter = useRef(0);
  const value = useMemo<ViewScopeValue>(
    () => ({
      register(label) {
        const id = ++counter.current;
        mounted.current.set(id, label);
        if (import.meta.env.DEV && mounted.current.size > 1) {
          console.warn(
            `[Nephoscope] View "${name}" has ${mounted.current.size} commit controls (${[...mounted.current.values()].join(', ')}). SPEC-0002 D-18 allows one per view.`,
          );
        }
        return () => {
          mounted.current.delete(id);
        };
      },
    }),
    [name],
  );
  return <ViewScopeContext.Provider value={value}>{children}</ViewScopeContext.Provider>;
}

export function useCommitRegistration(active: boolean, label: string) {
  const scope = useContext(ViewScopeContext);
  useEffect(() => {
    if (!active || !scope) return;
    return scope.register(label);
  }, [active, scope, label]);
}
