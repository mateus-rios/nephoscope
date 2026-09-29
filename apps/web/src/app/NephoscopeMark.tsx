/**
 * The Nephoscope mark: the instrument itself. A mirror nephoscope is a round mirror with compass
 * graduations on which a cloud's reflection is tracked; here, the ring, its cardinal ticks and a cloud.
 */
export function NephoscopeMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className="shrink-0"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10.5 20.5h10.2a2.9 2.9 0 0 0 .3-5.8 4.6 4.6 0 0 0-8.8-1 3.4 3.4 0 0 0-1.7 6.8z"
        stroke="var(--construct-ink)"
        strokeWidth="2"
      />
    </svg>
  );
}
