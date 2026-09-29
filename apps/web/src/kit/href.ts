/** Splits "/path?a=b" into the `to` and `search` TanStack Router expects. */
export function toLocation(href: string): { to: string; search: Record<string, string> } {
  const at = href.indexOf('?');
  if (at < 0) return { to: href, search: {} };
  return { to: href.slice(0, at), search: Object.fromEntries(new URLSearchParams(href.slice(at + 1))) };
}
