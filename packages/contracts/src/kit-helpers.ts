import type { KitAction, KitColumn, KitState } from './kit.js';

/** Building blocks of the kit catalog files (SPEC-0001 D-30). */

/** One path segment; never `.` or `..`. */
export const S = String.raw`(?!\.\.?(?:/|$))[A-Za-z0-9._~@%+=-]+`;
/** Path pattern for `locations/{l}/{collection}/{id}` and deeper chains of `{collection}/{id}`. */
export const located = (...collections: string[]) => `^locations/${S}${collections.map((c) => `/${c}/${S}`).join('')}$`;
export const plain = (...collections: string[]) => `^${collections.map((c) => `${c}/${S}`).join('/')}$`;

export const col = (
  id: string,
  header: string,
  path: string,
  kind?: KitColumn['kind'],
  width?: string,
  defaultHidden?: boolean,
): KitColumn => ({
  id,
  header,
  path,
  kind,
  width,
  defaultHidden,
});
export const created = (path = 'createTime') => col('created', 'Created', path, 'time', '9rem');
export const updated = (path = 'updateTime') => col('updated', 'Updated', path, 'time', '9rem', true);
export const location = col('location', 'Location', '_location', 'mono', '10rem');
export const labels = col('labels', 'Labels', 'labels', 'labels', undefined, true);
export const stateCol = (path = 'state', header = 'State') => col('state', header, path, 'state', '10rem');

export const ready = (path = 'state', extra: Partial<KitState> = {}): KitState => ({
  path,
  ok: ['READY', 'ACTIVE', 'RUNNING', 'SUCCEEDED', 'ENABLED', 'DONE', ...(extra.ok ?? [])],
  running: ['CREATING', 'UPDATING', 'DELETING', 'REPAIRING', 'RESTORING', 'PROVISIONING', 'STARTING', 'STOPPING', ...(extra.running ?? [])],
  error: ['ERROR', 'FAILED', 'INVALID', ...(extra.error ?? [])],
  paused: ['STOPPED', 'SUSPENDED', 'DISABLED', ...(extra.paused ?? [])],
  pending: ['PENDING', 'QUEUED', ...(extra.pending ?? [])],
  warn: extra.warn,
});

export const del = (singular: string, gcloud?: string): KitAction => ({
  id: 'delete',
  label: `Delete ${singular}`,
  consequence: `The ${singular} is deleted. This cannot be undone.`,
  danger: true,
  confirm: true,
  gcloud,
});
