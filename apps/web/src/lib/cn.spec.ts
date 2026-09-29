import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('lets a caller override a base width', () => {
    expect(cn('w-full px-2', 'w-64')).toBe('px-2 w-64');
  });
  it('keeps a Nephoscope text size and a Nephoscope color together', () => {
    expect(cn('text-dense text-ink', 'text-ink-2')).toBe('text-dense text-ink-2');
    expect(cn('text-meta', 'text-dense')).toBe('text-dense');
  });
  it('merges Nephoscope radii and backgrounds', () => {
    expect(cn('rounded-control bg-sheet', 'bg-well')).toBe('rounded-control bg-well');
  });
});
