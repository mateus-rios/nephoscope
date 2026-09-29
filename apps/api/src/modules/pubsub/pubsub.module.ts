import {
  CommitSchemaSchema,
  type Confirm,
  ConfirmSchema,
  type CreateSchema,
  CreateSchemaSchema,
  type CreateSnapshot,
  CreateSnapshotSchema,
  type CreateSubscription,
  CreateSubscriptionSchema,
  type CreateTopic,
  CreateTopicSchema,
  DeadLetterGrantsSchema,
  type ListResponse,
  PEEK_MAX,
  PeekSchema,
  ProjectIdParamSchema,
  PUBLISH_CONFIRM_THRESHOLD,
  type Publish,
  PublishSchema,
  type PubSubMessage,
  type PubSubSchema,
  type PubSubSnapshot,
  type PubSubSubscription,
  type PubSubTopic,
  PullAckSchema,
  type Resend,
  type ResendResult,
  ResendSchema,
  type Seek,
  SeekSchema,
  TopicSettingsSchema,
  UpdateSubscriptionSchema,
  type ValidateMessage,
  ValidateMessageSchema,
  ValidateSchemaSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, type OnModuleInit, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { ProblemException } from '../../core/problem/problem.js';
import { PubSubService } from './pubsub.service.js';
import { pubsubWatchChannel } from './pubsub-watch.js';

const p = { schema: ProjectIdParamSchema };
const id = {
  schema: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/]+$/),
};
const topicName = (projectId: string, t: string) => `projects/${projectId}/topics/${t}`;
const subName = (projectId: string, s: string) => `projects/${projectId}/subscriptions/${s}`;
const schemaName = (projectId: string, s: string) => `projects/${projectId}/schemas/${s}`;
const inProject = (projectId: string, name: string) => {
  if (!name.startsWith(`projects/${projectId}/`)) throw ProblemException.of('INVALID_ARGUMENT', `${name} belongs to another project.`);
};

@Controller('api/projects/:projectId/pubsub')
export class PubSubController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly pubsub: PubSubService,
  ) {}

  // ---- topics -------------------------------------------------------------------------------------

  @Get('topics')
  topics(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<PubSubTopic>> {
    return this.pubsub.topics(this.profiles.get(profileId), projectId);
  }

  @Post('topics')
  @Mutation({ product: 'pubsub', verb: 'topic.create', resource: 'projects/:projectId/topics' })
  createTopic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateTopicSchema }) body: CreateTopic,
  ): Promise<PubSubTopic> {
    return this.pubsub.createTopic(this.profiles.get(profileId), projectId, body);
  }

  @Get('topics/:topic')
  topic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
  ): Promise<PubSubTopic> {
    return this.pubsub.topic(this.profiles.get(profileId), topicName(projectId, topic));
  }

  @Get('topics/:topic/raw')
  topicRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
  ): Promise<unknown> {
    return this.pubsub.topicRaw(this.profiles.get(profileId), topicName(projectId, topic));
  }

  @Put('topics/:topic')
  @Mutation({ product: 'pubsub', verb: 'topic.update', resource: 'projects/:projectId/topics/:topic' })
  updateTopic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
    @Body({ schema: TopicSettingsSchema }) body: z.infer<typeof TopicSettingsSchema>,
  ): Promise<PubSubTopic> {
    return this.pubsub.updateTopic(this.profiles.get(profileId), projectId, topicName(projectId, topic), body);
  }

  @Delete('topics/:topic')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'topic.delete', resource: 'projects/:projectId/topics/:topic' })
  async deleteTopic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, topic);
    await this.pubsub.deleteTopic(this.profiles.get(profileId), projectId, topicName(projectId, topic));
  }

  @Get('topics/:topic/subscriptions')
  topicSubscriptions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
  ): Promise<string[]> {
    return this.pubsub.topicSubscriptions(this.profiles.get(profileId), topicName(projectId, topic));
  }

  @Get('topics/:topic/snapshots')
  topicSnapshots(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
  ): Promise<string[]> {
    return this.pubsub.topicSnapshots(this.profiles.get(profileId), topicName(projectId, topic));
  }

  @Post('topics/:topic/publish')
  @HttpCode(200)
  @Mutation({ product: 'pubsub', verb: 'topic.publish', resource: 'projects/:projectId/topics/:topic' })
  publish(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('topic', id) topic: string,
    @Body({ schema: PublishSchema }) body: Publish & z.infer<typeof PublishSchema>,
  ): Promise<{ messageIds: string[] }> {
    if (body.messages.length > PUBLISH_CONFIRM_THRESHOLD) requireConfirmation(body.confirm, String(body.messages.length));
    return this.pubsub.publish(this.profiles.get(profileId), projectId, topicName(projectId, topic), body);
  }

  // ---- subscriptions ------------------------------------------------------------------------------

  @Get('subscriptions')
  subscriptions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
  ): Promise<ListResponse<PubSubSubscription>> {
    return this.pubsub.subscriptions(this.profiles.get(profileId), projectId);
  }

  @Post('subscriptions')
  @Mutation({ product: 'pubsub', verb: 'subscription.create', resource: 'projects/:projectId/subscriptions' })
  createSubscription(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateSubscriptionSchema }) body: CreateSubscription,
  ): Promise<PubSubSubscription> {
    return this.pubsub.createSubscription(this.profiles.get(profileId), projectId, body);
  }

  @Get('subscriptions/:subscription')
  subscription(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
  ): Promise<PubSubSubscription> {
    return this.pubsub.subscription(this.profiles.get(profileId), subName(projectId, s));
  }

  @Get('subscriptions/:subscription/raw')
  subscriptionRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
  ): Promise<unknown> {
    return this.pubsub.subscriptionRaw(this.profiles.get(profileId), subName(projectId, s));
  }

  @Put('subscriptions/:subscription')
  @Mutation({ product: 'pubsub', verb: 'subscription.update', resource: 'projects/:projectId/subscriptions/:subscription' })
  updateSubscription(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: UpdateSubscriptionSchema }) body: z.infer<typeof UpdateSubscriptionSchema>,
  ): Promise<PubSubSubscription> {
    return this.pubsub.updateSubscription(this.profiles.get(profileId), projectId, subName(projectId, s), body);
  }

  @Delete('subscriptions/:subscription')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'subscription.delete', resource: 'projects/:projectId/subscriptions/:subscription' })
  async deleteSubscription(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, s);
    await this.pubsub.deleteSubscription(this.profiles.get(profileId), projectId, subName(projectId, s));
  }

  @Post('subscriptions/:subscription/detach')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'subscription.detach', resource: 'projects/:projectId/subscriptions/:subscription' })
  async detach(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, s);
    await this.pubsub.detach(this.profiles.get(profileId), projectId, subName(projectId, s));
  }

  /** Peek is a read for the audit's purposes, but it does touch delivery attempts; it stays allowed read-only (D-04). */
  @Post('subscriptions/:subscription/peek')
  @HttpCode(200)
  peek(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: PeekSchema }) body: { max: number },
  ): Promise<PubSubMessage[]> {
    return this.pubsub.peek(this.profiles.get(profileId), subName(projectId, s), Math.min(body.max ?? 10, PEEK_MAX));
  }

  @Post('subscriptions/:subscription/pull-ack')
  @HttpCode(200)
  @Mutation({ product: 'pubsub', verb: 'subscription.pullAck', resource: 'projects/:projectId/subscriptions/:subscription' })
  pullAck(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: PullAckSchema }) body: { max: number; confirm: string },
  ): Promise<PubSubMessage[]> {
    requireConfirmation(body.confirm, String(body.max));
    return this.pubsub.pullAck(this.profiles.get(profileId), projectId, subName(projectId, s), body.max);
  }

  @Post('subscriptions/:subscription/seek')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'subscription.seek', resource: 'projects/:projectId/subscriptions/:subscription' })
  async seek(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: SeekSchema }) body: Seek,
  ): Promise<void> {
    requireConfirmation(body.confirm, s);
    if ('snapshot' in body) inProject(projectId, body.snapshot);
    await this.pubsub.seek(this.profiles.get(profileId), projectId, subName(projectId, s), body);
  }

  @Post('subscriptions/:subscription/dead-letter-grants')
  @HttpCode(200)
  @Mutation({ product: 'pubsub', verb: 'deadLetter.grant', resource: 'projects/:projectId/subscriptions/:subscription' })
  grantDeadLetter(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('subscription', id) s: string,
    @Body({ schema: DeadLetterGrantsSchema }) body: { projectNumber: string },
  ): Promise<{ member: string }> {
    return this.pubsub.grantDeadLetter(this.profiles.get(profileId), projectId, subName(projectId, s), body.projectNumber);
  }

  @Post('resend')
  @HttpCode(200)
  @Mutation({ product: 'pubsub', verb: 'deadLetter.resend', resource: 'projects/:projectId/topics' })
  resend(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: ResendSchema }) body: Resend,
  ): Promise<ResendResult> {
    inProject(projectId, body.from);
    inProject(projectId, body.to);
    if (body.messageIds.length > 1) requireConfirmation(body.confirm, String(body.messageIds.length));
    return this.pubsub.resend(this.profiles.get(profileId), projectId, body);
  }

  // ---- snapshots ------------------------------------------------------------------------------------

  @Get('snapshots')
  snapshots(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<PubSubSnapshot>> {
    return this.pubsub.snapshots(this.profiles.get(profileId), projectId);
  }

  @Post('snapshots')
  @Mutation({ product: 'pubsub', verb: 'snapshot.create', resource: 'projects/:projectId/snapshots' })
  createSnapshot(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateSnapshotSchema }) body: CreateSnapshot,
  ): Promise<PubSubSnapshot> {
    inProject(projectId, body.subscription);
    return this.pubsub.createSnapshot(this.profiles.get(profileId), projectId, body.id, body.subscription);
  }

  @Delete('snapshots/:snapshot')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'snapshot.delete', resource: 'projects/:projectId/snapshots/:snapshot' })
  async deleteSnapshot(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('snapshot', id) snapshot: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, snapshot);
    await this.pubsub.deleteSnapshot(this.profiles.get(profileId), projectId, `projects/${projectId}/snapshots/${snapshot}`);
  }

  // ---- schemas -----------------------------------------------------------------------------------------

  @Get('schemas')
  schemas(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<PubSubSchema>> {
    return this.pubsub.schemasList(this.profiles.get(profileId), projectId);
  }

  @Post('schemas')
  @Mutation({ product: 'pubsub', verb: 'schema.create', resource: 'projects/:projectId/schemas' })
  createSchema(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateSchemaSchema }) body: CreateSchema,
  ): Promise<PubSubSchema> {
    return this.pubsub.createSchema(this.profiles.get(profileId), projectId, body);
  }

  @Post('schemas/validate')
  @HttpCode(200)
  validateSchema(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: ValidateSchemaSchema }) body: z.infer<typeof ValidateSchemaSchema>,
  ): Promise<{ valid: boolean; message: string | null }> {
    return this.pubsub.validateSchema(this.profiles.get(profileId), projectId, body.type, body.definition);
  }

  @Get('schemas/:schema')
  schema(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
  ): Promise<PubSubSchema> {
    return this.pubsub.schema(this.profiles.get(profileId), schemaName(projectId, schema));
  }

  @Get('schemas/:schema/revisions')
  revisions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
  ): Promise<PubSubSchema[]> {
    return this.pubsub.revisions(this.profiles.get(profileId), schemaName(projectId, schema));
  }

  @Post('schemas/:schema/commit')
  @Mutation({ product: 'pubsub', verb: 'schema.commit', resource: 'projects/:projectId/schemas/:schema' })
  commit(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
    @Body({ schema: CommitSchemaSchema }) body: z.infer<typeof CommitSchemaSchema>,
  ): Promise<PubSubSchema> {
    return this.pubsub.commitSchema(this.profiles.get(profileId), projectId, schemaName(projectId, schema), body.type, body.definition);
  }

  @Post('schemas/:schema/rollback')
  @Mutation({ product: 'pubsub', verb: 'schema.rollback', resource: 'projects/:projectId/schemas/:schema' })
  rollback(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
    @Body({ schema: z.object({ revisionId: z.string().min(1).max(64) }) }) body: { revisionId: string },
  ): Promise<PubSubSchema> {
    return this.pubsub.rollbackSchema(this.profiles.get(profileId), projectId, schemaName(projectId, schema), body.revisionId);
  }

  @Delete('schemas/:schema/revisions/:revision')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'schema.deleteRevision', resource: 'projects/:projectId/schemas/:schema' })
  async deleteRevision(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
    @Param('revision', { schema: z.string().min(1).max(64) }) revision: string,
  ): Promise<void> {
    await this.pubsub.deleteRevision(this.profiles.get(profileId), projectId, schemaName(projectId, schema), revision);
  }

  @Delete('schemas/:schema')
  @HttpCode(204)
  @Mutation({ product: 'pubsub', verb: 'schema.delete', resource: 'projects/:projectId/schemas/:schema' })
  async deleteSchema(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, schema);
    await this.pubsub.deleteSchema(this.profiles.get(profileId), projectId, schemaName(projectId, schema));
  }

  @Post('schemas/:schema/validate-message')
  @HttpCode(200)
  validateMessage(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('schema', id) schema: string,
    @Body({ schema: ValidateMessageSchema }) body: ValidateMessage,
  ): Promise<{ valid: boolean; message: string | null }> {
    return this.pubsub.validateMessage(this.profiles.get(profileId), projectId, schemaName(projectId, schema), body);
  }
}

/** Pub/Sub (SPEC-0006 §7.1). */
@Module({ controllers: [PubSubController], providers: [PubSubService], exports: [PubSubService] })
export class PubSubModule implements OnModuleInit {
  constructor(
    private readonly live: LiveGateway,
    private readonly pubsub: PubSubService,
  ) {}

  onModuleInit(): void {
    this.live.register(pubsubWatchChannel(this.pubsub));
  }
}
