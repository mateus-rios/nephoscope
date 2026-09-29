import type { ColorTag } from '@nephoscope/contracts';
import { cn } from '../lib/cn';
import { fnv1a, initialsOf } from '../lib/hash';

const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'hexagon', 'pentagon'] as const;
type Shape = (typeof SHAPES)[number];

const tagClass: Record<ColorTag, string> = {
  none: 'text-ink-2',
  gray: 'text-tag-gray',
  blue: 'text-tag-blue',
  green: 'text-tag-green',
  amber: 'text-tag-amber',
  red: 'text-tag-red',
  violet: 'text-tag-violet',
};

function polygon(sides: number, rotation: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push(`${(12 + 10.5 * Math.cos(a)).toFixed(2)},${(12 + 10.5 * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function ShapePath({ shape }: { shape: Shape }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 'circle':
      return <circle cx="12" cy="12" r="10.5" {...common} />;
    case 'square':
      return <rect x="2" y="2" width="20" height="20" rx="2" {...common} />;
    case 'triangle':
      return <polygon points="12,1.5 22.5,21.5 1.5,21.5" {...common} />;
    case 'diamond':
      return <polygon points="12,1 23,12 12,23 1,12" {...common} />;
    case 'hexagon':
      return <polygon points={polygon(6, Math.PI / 6)} {...common} />;
    case 'pentagon':
      return <polygon points={polygon(5, -Math.PI / 2)} {...common} />;
  }
}

interface ProfileMarkProps {
  seed: string;
  principal: string | null;
  name: string;
  colorTag: ColorTag;
  size?: number;
  className?: string;
}

/**
 * A mark generated from the profile's key: shape from a hash, the principal's initials, the tag
 * color. Tells profiles apart even when they share a color (SPEC-0002 D-19).
 */
export function ProfileMark({ seed, principal, name, colorTag, size = 22, className }: ProfileMarkProps) {
  const shape = SHAPES[fnv1a(seed) % SHAPES.length] ?? 'circle';
  const initials = initialsOf(principal, name);
  const textY = shape === 'triangle' ? 16.5 : 15.2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`Mark of profile ${name}`}
      className={cn('shrink-0', tagClass[colorTag], className)}
    >
      <ShapePath shape={shape} />
      <text
        x="12"
        y={textY}
        textAnchor="middle"
        fontSize={shape === 'triangle' ? 7 : 8.5}
        fontWeight={650}
        fontStretch="75%"
        className="fill-ink"
        style={{ fontFamily: 'var(--font-ui)', letterSpacing: '0.02em' }}
      >
        {initials}
      </text>
    </svg>
  );
}
