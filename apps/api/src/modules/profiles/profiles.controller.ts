import {
  type AddProfile,
  type AddProfileResult,
  AddProfileSchema,
  type Confirm,
  ConfirmSchema,
  type Profile,
  type ProfileCheck,
  type UpdateProfile,
  UpdateProfileSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';

const ProfileIdSchema = z.string().min(1).max(64);

/** Connections page API (SPEC-0001 §8.1). */
@Controller('api/profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(): Profile[] {
    return this.profiles.list();
  }

  @Post()
  @Mutation({ product: 'connections', verb: 'profile.add', scope: 'local' })
  add(@Body({ schema: AddProfileSchema }) body: AddProfile): Promise<AddProfileResult> {
    return this.profiles.add(body);
  }

  @Patch(':id')
  @Mutation({ product: 'connections', verb: 'profile.update', resource: 'profiles/:id', scope: 'local' })
  update(
    @Param('id', { schema: ProfileIdSchema }) id: string,
    @Body({ schema: UpdateProfileSchema }) body: UpdateProfile,
  ): Promise<Profile> {
    return this.profiles.update(id, body);
  }

  @Post(':id/test')
  test(@Param('id', { schema: ProfileIdSchema }) id: string): Promise<ProfileCheck> {
    return this.profiles.test(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Mutation({ product: 'connections', verb: 'profile.delete', resource: 'profiles/:id', scope: 'local' })
  async remove(@Param('id', { schema: ProfileIdSchema }) id: string, @Body({ schema: ConfirmSchema }) body: Confirm): Promise<void> {
    requireConfirmation(body.confirm, this.profiles.get(id).profile.name);
    await this.profiles.remove(id);
  }

  /** Discards saved profiles that cannot be decrypted (SPEC-0001 CA-05). */
  @Post('reset')
  @HttpCode(204)
  @Mutation({ product: 'connections', verb: 'profile.reset', scope: 'local' })
  async reset(@Body({ schema: ConfirmSchema }) body: Confirm): Promise<void> {
    requireConfirmation(body.confirm, 'reset');
    await this.profiles.resetSaved();
  }
}
