import { Module, type OnModuleInit } from '@nestjs/common';
import { sdk } from '../../core/gcp/sdk.js';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { FirestoreController } from './firestore.controller.js';
import { FirestoreAdminService } from './firestore-admin.service.js';
import { FirestoreClients } from './firestore-clients.js';
import { FirestoreDataService } from './firestore-data.service.js';
import { firestoreListenChannel } from './firestore-listen.js';
import { FirestoreRulesService } from './firestore-rules.service.js';

/** Firestore (SPEC-0004). */
@Module({
  controllers: [FirestoreController],
  providers: [FirestoreClients, FirestoreDataService, FirestoreAdminService, FirestoreRulesService],
  exports: [FirestoreClients, FirestoreDataService],
})
export class FirestoreModule implements OnModuleInit {
  constructor(
    private readonly live: LiveGateway,
    private readonly clients: FirestoreClients,
  ) {}

  onModuleInit(): void {
    this.live.register(firestoreListenChannel(this.clients, () => sdk.firestore()));
  }
}
