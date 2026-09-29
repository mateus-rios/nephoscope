import { useEffect, useState } from 'react';

/**
 * Resolves design tokens to #rrggbb for libraries that cannot read CSS variables (Monaco,
 * charts). Colors stay defined only in tokens.css (SPEC-0002 G6).
 */
export function tokenHex(name: string, scope: Element = document.documentElement): string {
  const value = getComputedStyle(scope).getPropertyValue(`--${name}`).trim();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx || !value) return value;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Token colors that follow theme changes. */
export function useTokenColors<const N extends readonly string[]>(names: N): Record<N[number], string> {
  const read = () => Object.fromEntries(names.map((n) => [n, tokenHex(n)])) as Record<N[number], string>;
  const [colors, setColors] = useState(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: names are constant for a component; read depends only on them.
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [names.join('|')]);
  return colors;
}
