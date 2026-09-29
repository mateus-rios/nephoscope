import { SetMetadata } from '@nestjs/common';

export const MUTATION_KEY = 'nephoscope:mutation';

export interface MutationMeta {
  /** Product id from the registry, such as `apis`. */
  product: string;
  /** Short verb for the audit log, such as `service.enable`. */
  verb: string;
  /**
   * Resource template filled from route params, such as `projects/:projectId/services/:service`.
   */
  resource?: string;
  /**
   * `gcp` (default): changes Google Cloud; blocked by read-only mode (SPEC-0001 D-12).
   * `local`: changes Nephoscope's own state (profiles, preferences); audited, never blocked.
   * `reveal`: reads a secret value; allowed in read-only mode, audited (SPEC-0007 D-07).
   */
  scope?: 'gcp' | 'local' | 'reveal';
}

/** Marks a route as a mutation: read-only guard and audit apply (SPEC-0001 CA-48, CA-51). */
export const Mutation = (meta: MutationMeta) => SetMetadata(MUTATION_KEY, meta);

export function fillResource(template: string | undefined, params: Record<string, string>): string | null {
  if (!template) return null;
  return template.replace(/:([a-zA-Z]+)/g, (_m, name: string) => params[name] ?? `:${name}`);
}
