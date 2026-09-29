import { z } from 'zod';

/** The minimal image picker of SPEC-0003 D-17; the full product comes in SPEC-0007 (M5). */

export interface ArtifactRepository {
  name: string;
  id: string;
  location: string;
  format: string;
  description: string | null;
  /** Host and path prefix of images, such as `us-docker.pkg.dev/proj/repo`. */
  registryUri: string;
}

export interface DockerImage {
  /** Image path inside the repository, without registry, tag or digest. */
  image: string;
  /** Full reference by digest, such as `us-docker.pkg.dev/proj/repo/app@sha256:...`. */
  uri: string;
  digest: string;
  tags: string[];
  sizeBytes: string | null;
  uploadTime: string | null;
  updateTime: string | null;
}

export const DockerImagesQuerySchema = z.object({
  repository: z
    .string()
    .regex(/^projects\/[^/]+\/locations\/[^/]+\/repositories\/[^/]+$/, 'A repository name')
    .max(512),
  pageToken: z.string().max(4096).optional(),
});
export type DockerImagesQuery = z.infer<typeof DockerImagesQuerySchema>;
