import type { ArtifactRepository, DockerImage, ListResponse } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { timestampToIso } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';

// biome-ignore lint/suspicious/noExplicitAny: generated message types are read field by field.
type Any = any;

const shortName = (name: string) => name.split('/').pop() ?? name;

export function mapRepository(r: Any, projectId: string): ArtifactRepository {
  const name = String(r?.name ?? '');
  const location = /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
  const id = shortName(name);
  return {
    name,
    id,
    location,
    format: String(r?.format ?? 'FORMAT_UNSPECIFIED').replace(/^FORMAT_/, ''),
    description: r?.description || null,
    registryUri: r?.registryUri || `${location}-docker.pkg.dev/${projectId}/${id}`,
  };
}

export function mapDockerImage(i: Any): DockerImage {
  const uri = String(i?.uri ?? '');
  const at = uri.lastIndexOf('@');
  const withoutDigest = at > 0 ? uri.slice(0, at) : uri;
  // uri is host/project/repository/image path@digest.
  const image = withoutDigest.split('/').slice(3).join('/');
  return {
    image,
    uri,
    digest: at > 0 ? uri.slice(at + 1) : '',
    tags: [...(i?.tags ?? [])],
    sizeBytes: i?.imageSizeBytes === undefined || i?.imageSizeBytes === null ? null : String(i.imageSizeBytes),
    uploadTime: timestampToIso(i?.uploadTime),
    updateTime: timestampToIso(i?.updateTime),
  };
}

/** Docker repositories and images for the deploy form's picker (SPEC-0003 D-17). */
@Injectable()
export class ArtifactsService {
  private readonly wildcard = new WildcardSupport();

  constructor(private readonly clients: GcpClientFactory) {}

  private async client(profileId: string) {
    const { ArtifactRegistryClient } = await sdk.artifactRegistry();
    return this.clients.get(profileId, 'artifactregistry', (auth) => new ArtifactRegistryClient({ auth }));
  }

  async repositories(h: ProfileHandle, projectId: string): Promise<ListResponse<ArtifactRepository>> {
    const client = await this.client(h.profile.id);
    const list = async (location: string) => {
      const [items] = await client.listRepositories({ parent: `projects/${projectId}/locations/${location}`, pageSize: 1000 });
      return items.map((r) => mapRepository(r, projectId)).filter((r) => r.format === 'DOCKER');
    };
    const result = await this.wildcard.list(
      'artifactregistry.repositories',
      async () => ({ items: await list('-'), nextPageToken: null }),
      async () => {
        const locations: string[] = [];
        for await (const l of client.listLocationsAsync({ name: `projects/${projectId}` })) {
          if (l.locationId) locations.push(l.locationId);
        }
        return fanOut(locations, list);
      },
    );
    result.items.sort((a, b) => a.location.localeCompare(b.location) || a.id.localeCompare(b.id));
    return result;
  }

  async images(h: ProfileHandle, repository: string, pageToken?: string): Promise<ListResponse<DockerImage>> {
    const client = await this.client(h.profile.id);
    const [items, , response] = await client.listDockerImages(
      { parent: repository, pageSize: 200, pageToken, orderBy: 'update_time desc' },
      { autoPaginate: false },
    );
    return { items: items.map(mapDockerImage), nextPageToken: response?.nextPageToken || null };
  }
}
