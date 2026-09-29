import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Nephoscope's own type scale and colors, so a caller's class replaces the conflicting default
 * (a `w-64` over an input's `w-full`) and a size is never mistaken for a color.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['legend', 'meta', 'dense', 'body', 'section', 'page'],
      color: [
        'film',
        'sheet',
        'panel',
        'well',
        'hover',
        'ink',
        'ink-2',
        'ink-3',
        'ink-inverse',
        'rule',
        'rule-strong',
        'construct',
        'construct-tint',
        'construct-ink',
        'commit',
        'commit-hover',
        'commit-ink',
        'redline',
        'redline-hover',
        'redline-tint',
        'redline-ink',
        'warn',
        'warn-tint',
        'warn-ink',
        'ok',
        'ok-tint',
        'ok-ink',
        'focus',
        'overlay',
        'tag-none',
        'tag-gray',
        'tag-blue',
        'tag-green',
        'tag-amber',
        'tag-red',
        'tag-violet',
      ],
      radius: ['control', 'menu', 'dialog', 'pill'],
    },
  },
});

export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}
