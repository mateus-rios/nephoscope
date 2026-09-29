import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit/audit.service.js';
import { AuditInterceptor, ReadOnlyGuard } from './audit/guard-and-audit.js';
import { CapabilitiesService } from './capabilities/capabilities.service.js';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from './config/config.js';
import { ProfilesService } from './credentials/profiles.service.js';
import { GcpClientFactory } from './gcp/client-factory.js';
import { InvokeService } from './invoke/invoke.service.js';
import { LiveGateway } from './live/live.gateway.js';
import { OperationsService } from './operations/operations.service.js';
import { AccessToken } from './security/access-token.js';
import { HistoryService } from './store/history.service.js';
import { JsonStore } from './store/json-store.js';
import { PrefsService } from './store/prefs.service.js';

const shared = [
  JsonStore,
  ProfilesService,
  GcpClientFactory,
  AuditService,
  OperationsService,
  CapabilitiesService,
  PrefsService,
  HistoryService,
  InvokeService,
  LiveGateway,
];

/** Platform services shared by every product module (SPEC-0001 §7). */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: NephoscopeConfig, token: AccessToken): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: NEPHOSCOPE_CONFIG, useValue: config },
        { provide: AccessToken, useValue: token },
        ...shared,
        { provide: APP_GUARD, useClass: ReadOnlyGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
      exports: [NEPHOSCOPE_CONFIG, AccessToken, ...shared],
    };
  }
}
