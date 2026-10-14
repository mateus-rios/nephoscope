import {
  type IamPolicyView,
  ProjectIdParamSchema,
  type ResourceIamKind,
  type ResourceIamQuery,
  ResourceIamQuerySchema,
  type SetIamPolicy,
  SetIamPolicySchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, Injectable, Param, Put, Query } from '@nestjs/common';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { mapPolicy, policyBody } from './iam-mapping.js';

const SEG = '[A-Za-z0-9_.-]+';

interface Kind {
  /** Name pattern after `projects/{project}/`. */
  pattern: RegExp;
  url: (name: string) => string;
  product: string;
}

/** The resources the shared Permissions tab may read and write; nothing else is reachable. */
const KINDS: Record<ResourceIamKind, Kind> = {
  secret: {
    pattern: new RegExp(`^(secrets/${SEG}|locations/${SEG}/secrets/${SEG})$`),
    url: (name) => {
      const loc = /\/locations\/([^/]+)\//.exec(name)?.[1];
      return loc ? `https://secretmanager.${loc}.rep.googleapis.com/v1/${name}` : `https://secretmanager.googleapis.com/v1/${name}`;
    },
    product: 'secretmanager',
  },
  'kms-keyring': {
    pattern: new RegExp(`^locations/${SEG}/keyRings/${SEG}$`),
    url: (name) => `https://cloudkms.googleapis.com/v1/${name}`,
    product: 'kms',
  },
  'kms-key': {
    pattern: new RegExp(`^locations/${SEG}/keyRings/${SEG}/cryptoKeys/${SEG}$`),
    url: (name) => `https://cloudkms.googleapis.com/v1/${name}`,
    product: 'kms',
  },
  'ar-repo': {
    pattern: new RegExp(`^locations/${SEG}/repositories/${SEG}$`),
    url: (name) => `https://artifactregistry.googleapis.com/v1/${name}`,
    product: 'artifactregistry',
  },
};

/** Reads and writes the IAM policy of an allow-listed resource (SPEC-0001 CA-64). */
@Injectable()
export class ResourceIamService {
  constructor(private readonly operations: OperationsService) {}

  private resolve(projectId: string, q: ResourceIamQuery): { kind: Kind; name: string; url: string } {
    const kind = KINDS[q.kind];
    const prefix = `projects/${projectId}/`;
    const rel = q.name.startsWith(prefix) ? q.name.slice(prefix.length) : null;
    if (!rel || !kind.pattern.test(rel) || rel.split('/').some((s) => s === '.' || s === '..')) {
      throw ProblemException.of('INVALID_ARGUMENT', `The name does not name a ${q.kind} of project ${projectId}.`);
    }
    return { kind, name: q.name, url: kind.url(q.name) };
  }

  async get(h: ProfileHandle, projectId: string, q: ResourceIamQuery): Promise<IamPolicyView> {
    const { url } = this.resolve(projectId, q);
    return mapPolicy(await rest(h, '').get(`${url}:getIamPolicy`, { 'options.requestedPolicyVersion': 3 }));
  }

  async set(h: ProfileHandle, projectId: string, q: ResourceIamQuery, body: SetIamPolicy): Promise<IamPolicyView> {
    const { kind, name, url } = this.resolve(projectId, q);
    const saved = await rest(h, '').post(`${url}:setIamPolicy`, { policy: policyBody(body) });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: kind.product,
      kind: `${kind.product}.setIamPolicy`,
      resource: { name, displayName: `Save permissions of ${name.split('/').pop()}`, href: null },
    });
    return mapPolicy(saved);
  }
}

@Controller('api/projects/:projectId/resource-iam')
export class ResourceIamController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly iam: ResourceIamService,
  ) {}

  @Get()
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: ResourceIamQuerySchema }) q: ResourceIamQuery,
  ) {
    return this.iam.get(this.profiles.get(profileId), projectId, q);
  }

  @Put()
  @Mutation({ product: 'iam', verb: 'resource.setIamPolicy', resource: 'projects/:projectId' })
  set(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: ResourceIamQuerySchema }) q: ResourceIamQuery,
    @Body({ schema: SetIamPolicySchema }) body: SetIamPolicy,
  ) {
    return this.iam.set(this.profiles.get(profileId), projectId, q, body);
  }
}
