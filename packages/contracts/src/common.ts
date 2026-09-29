import { z } from 'zod';
import { DEFAULT_PAGE_SIZE } from './constants.js';

/** List envelope of SPEC-0001 CA-26. */
export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextPageToken: z.string().nullable(),
    unreachable: z.array(z.string()).optional(),
  });
}

export interface ListResponse<T> {
  items: T[];
  nextPageToken: string | null;
  unreachable?: string[];
}

export const ListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  pageToken: z.string().max(4096).optional(),
  filter: z.string().max(4096).optional(),
  orderBy: z.string().max(512).optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

/** Google project ids: 6 to 30 characters, lowercase letters, digits and hyphens. Legacy ids may contain a domain prefix. */
export const ProjectIdParamSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9.:-]+$/, 'Invalid project id');

export { DEFAULT_PAGE_SIZE };
