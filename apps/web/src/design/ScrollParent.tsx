import { createContext, useContext } from 'react';

/** The shell's scrolling element, so virtualized lists scroll with the page (SPEC-0002 CA-19). */
export const ScrollParentContext = createContext<HTMLElement | null>(null);

export function useScrollParent(): HTMLElement | null {
  return useContext(ScrollParentContext);
}
