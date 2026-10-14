import {
  type AddKeyAsProfile,
  AddKeyAsProfileSchema,
  type Confirm,
  ConfirmSchema,
  type CreateServiceAccount,
  CreateServiceAccountSchema,
  type IamPolicyView,
  type NewKeyView,
  type Profile,
  type ProjectIamView,
  ProjectIdParamSchema,
  type RoleDetail,
  type RoleSearch,
  RoleSearchSchema,
  type RoleSummary,
  type SaveCustomRole,
  SaveCustomRoleSchema,
  ServiceAccountEmailSchema,
  type ServiceAccountKeyView,
  type ServiceAccountView,
  type SetIamPolicy,
  SetIamPolicySchema,
  type TestablePermission,
  TestPermissionsSchema,
  type Troubleshoot,
  TroubleshootSchema,
  type TroubleshootView,
  UndeleteServiceAccountSchema,
  type UpdateServiceAccount,
  UpdateServiceAccountSchema,
  UploadKeySchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { IamService } from './iam.service.js';
import { ResourceIamController, ResourceIamService } from './resource-iam.js';

const p = { schema: ProjectIdParamSchema };
const sa = { schema: ServiceAccountEmailSchema };
const keyId = { schema: z.string().regex(/^[0-9a-f]{20,64}$/) };
const roleId = { schema: z.string().regex(/^[a-zA-Z0-9_.]{3,64}$/) };
const RoleNameQuery = z.object({
  name: z
    .string()
    .regex(/^(roles\/[a-zA-Z0-9_.]+|projects\/[a-z0-9.:-]+\/roles\/[a-zA-Z0-9_.]+|organizations\/[0-9]+\/roles\/[a-zA-Z0-9_.]+)$/),
});
const SA = 'projects/:projectId/serviceAccounts/:email';

@Controller('api/projects/:projectId/iam')
export class IamController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly iam: IamService,
  ) {}

  @Get('policy')
  policy(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ProjectIamView> {
    return this.iam.projectPolicy(this.profiles.get(profileId), projectId);
  }

  @Put('policy')
  @Mutation({ product: 'iam', verb: 'policy.set', resource: 'projects/:projectId' })
  setPolicy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SetIamPolicySchema }) body: SetIamPolicy,
  ): Promise<IamPolicyView> {
    return this.iam.setProjectPolicy(this.profiles.get(profileId), projectId, body);
  }

  @Get('roles')
  roles(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RoleSearchSchema }) q: RoleSearch,
  ): Promise<RoleSummary[]> {
    return this.iam.searchRoles(this.profiles.get(profileId), projectId, q);
  }

  @Get('role')
  role(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) _projectId: string,
    @Query({ schema: RoleNameQuery }) q: { name: string },
  ): Promise<RoleDetail> {
    return this.iam.getRole(this.profiles.get(profileId), q.name);
  }

  @Get('testable-permissions')
  testable(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<TestablePermission[]> {
    return this.iam.testablePermissions(this.profiles.get(profileId), projectId);
  }

  @Post('roles')
  @Mutation({ product: 'iam', verb: 'role.create', resource: 'projects/:projectId/roles' })
  createRole(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SaveCustomRoleSchema }) body: SaveCustomRole,
  ): Promise<RoleDetail> {
    return this.iam.createRole(this.profiles.get(profileId), projectId, body);
  }

  @Put('roles/:role')
  @Mutation({ product: 'iam', verb: 'role.update', resource: 'projects/:projectId/roles/:role' })
  updateRole(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('role', roleId) role: string,
    @Body({ schema: SaveCustomRoleSchema }) body: SaveCustomRole,
  ): Promise<RoleDetail> {
    return this.iam.updateRole(this.profiles.get(profileId), projectId, role, body);
  }

  @Delete('roles/:role')
  @HttpCode(204)
  @Mutation({ product: 'iam', verb: 'role.delete', resource: 'projects/:projectId/roles/:role' })
  async deleteRole(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('role', roleId) role: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, role);
    await this.iam.deleteRole(this.profiles.get(profileId), projectId, role);
  }

  @Post('roles/:role/undelete')
  @Mutation({ product: 'iam', verb: 'role.undelete', resource: 'projects/:projectId/roles/:role' })
  undeleteRole(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('role', roleId) role: string,
  ): Promise<RoleDetail> {
    return this.iam.undeleteRole(this.profiles.get(profileId), projectId, role);
  }

  @Get('service-accounts')
  serviceAccounts(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ServiceAccountView[]> {
    return this.iam.listServiceAccounts(this.profiles.get(profileId), projectId);
  }

  @Post('service-accounts')
  @Mutation({ product: 'iam', verb: 'serviceAccount.create', resource: 'projects/:projectId/serviceAccounts' })
  createServiceAccount(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateServiceAccountSchema }) body: CreateServiceAccount,
  ): Promise<ServiceAccountView> {
    return this.iam.createServiceAccount(this.profiles.get(profileId), projectId, body);
  }

  @Post('service-accounts/undelete')
  @Mutation({ product: 'iam', verb: 'serviceAccount.undelete', resource: 'projects/:projectId/serviceAccounts' })
  undeleteServiceAccount(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: UndeleteServiceAccountSchema }) body: { uniqueId: string },
  ): Promise<ServiceAccountView> {
    return this.iam.undeleteServiceAccount(this.profiles.get(profileId), projectId, body.uniqueId);
  }

  @Get('service-accounts/:email')
  serviceAccount(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
  ): Promise<ServiceAccountView> {
    return this.iam.getServiceAccount(this.profiles.get(profileId), projectId, email);
  }

  @Patch('service-accounts/:email')
  @Mutation({ product: 'iam', verb: 'serviceAccount.update', resource: SA })
  updateServiceAccount(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Body({ schema: UpdateServiceAccountSchema }) body: UpdateServiceAccount,
  ): Promise<ServiceAccountView> {
    return this.iam.updateServiceAccount(this.profiles.get(profileId), projectId, email, body);
  }

  @Post('service-accounts/:email/:action')
  @HttpCode(204)
  @Mutation({ product: 'iam', verb: 'serviceAccount.:action', resource: SA })
  async setEnabled(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Param('action', { schema: z.enum(['enable', 'disable']) }) action: 'enable' | 'disable',
  ): Promise<void> {
    await this.iam.setServiceAccountEnabled(this.profiles.get(profileId), projectId, email, action === 'enable');
  }

  @Delete('service-accounts/:email')
  @HttpCode(204)
  @Mutation({ product: 'iam', verb: 'serviceAccount.delete', resource: SA })
  async deleteServiceAccount(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, email);
    await this.iam.deleteServiceAccount(this.profiles.get(profileId), projectId, email);
  }

  @Get('service-accounts/:email/keys')
  keys(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
  ): Promise<ServiceAccountKeyView[]> {
    return this.iam.listKeys(this.profiles.get(profileId), projectId, email);
  }

  @Post('service-accounts/:email/keys')
  @Mutation({ product: 'iam', verb: 'key.create', resource: `${SA}/keys` })
  createKey(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
  ): Promise<NewKeyView> {
    return this.iam.createKey(this.profiles.get(profileId), projectId, email);
  }

  @Post('service-accounts/:email/keys/upload')
  @Mutation({ product: 'iam', verb: 'key.upload', resource: `${SA}/keys` })
  uploadKey(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Body({ schema: UploadKeySchema }) body: { publicKeyPem: string },
  ): Promise<ServiceAccountKeyView> {
    return this.iam.uploadKey(this.profiles.get(profileId), projectId, email, body.publicKeyPem);
  }

  @Post('service-accounts/:email/keys/:key/:action')
  @HttpCode(204)
  @Mutation({ product: 'iam', verb: 'key.:action', resource: `${SA}/keys/:key` })
  async setKeyEnabled(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Param('key', keyId) key: string,
    @Param('action', { schema: z.enum(['enable', 'disable']) }) action: 'enable' | 'disable',
  ): Promise<void> {
    await this.iam.setKeyEnabled(this.profiles.get(profileId), projectId, email, key, action === 'enable');
  }

  @Delete('service-accounts/:email/keys/:key')
  @HttpCode(204)
  @Mutation({ product: 'iam', verb: 'key.delete', resource: `${SA}/keys/:key` })
  async deleteKey(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Param('key', keyId) key: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, key.slice(0, 12));
    await this.iam.deleteKey(this.profiles.get(profileId), projectId, email, key);
  }

  @Get('service-accounts/:email/policy')
  saPolicy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
  ): Promise<IamPolicyView> {
    return this.iam.serviceAccountPolicy(this.profiles.get(profileId), projectId, email);
  }

  @Put('service-accounts/:email/policy')
  @Mutation({ product: 'iam', verb: 'serviceAccount.setIamPolicy', resource: SA })
  setSaPolicy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('email', sa) email: string,
    @Body({ schema: SetIamPolicySchema }) body: SetIamPolicy,
  ): Promise<IamPolicyView> {
    return this.iam.setServiceAccountPolicy(this.profiles.get(profileId), projectId, email, body);
  }

  /** A read with a body (SPEC-0007 D-04): never a mutation. */
  @Post('test-permissions')
  @HttpCode(200)
  test(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: TestPermissionsSchema }) body: { permissions: string[] },
  ): Promise<{ granted: string[]; denied: string[] }> {
    return this.iam.testPermissions(this.profiles.get(profileId), projectId, body.permissions);
  }

  @Post('troubleshoot')
  @HttpCode(200)
  troubleshoot(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: TroubleshootSchema }) body: Troubleshoot,
  ): Promise<TroubleshootView> {
    return this.iam.troubleshoot(this.profiles.get(profileId), projectId, body);
  }
}

const handle = { schema: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/) };

/** A new key's one-time handle (SPEC-0007 D-02). Not under a project: the handle is the capability. */
@Controller('api/iam/new-keys/:handle')
export class NewKeysController {
  constructor(private readonly iam: IamService) {}

  /** The key file, once, never cached; audited like a secret reveal (SPEC-0007 D-07). */
  @Get('download')
  @Mutation({ product: 'iam', verb: 'key.download', scope: 'reveal' })
  download(@Param('handle', handle) h: string, @Res({ passthrough: true }) res: Response): string {
    const { json, fileName } = this.iam.downloadKey(h);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    return json;
  }

  @Post('profile')
  @Mutation({ product: 'nephoscope', verb: 'profile.add', scope: 'local' })
  addProfile(@Param('handle', handle) h: string, @Body({ schema: AddKeyAsProfileSchema }) body: AddKeyAsProfile): Promise<Profile> {
    return this.iam.addKeyAsProfile(h, body);
  }
}

/** IAM (SPEC-0007 M5.1). */
@Module({ controllers: [IamController, NewKeysController, ResourceIamController], providers: [IamService, ResourceIamService] })
export class IamModule {}
