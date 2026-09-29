import { createRequire } from 'node:module';
import { Inject, Injectable } from '@nestjs/common';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { sdk } from '../../core/gcp/sdk.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: generated clients are loosely typed at this boundary.
type Any = any;

/** The gax copy the Firestore package itself uses, so its channel credentials match. */
function firestoreGax(): Any {
  const here = createRequire(import.meta.url);
  return createRequire(here.resolve('@google-cloud/firestore'))('google-gax');
}

export interface DataClient {
  // biome-ignore lint/suspicious/noExplicitAny: the generated v1.FirestoreClient.
  client: any;
  /** Per-call options: the emulator needs `Bearer owner` to bypass security rules. */
  opts: { otherArgs?: { headers: Record<string, string> } };
}

/**
 * Firestore clients per profile (SPEC-0004 D-01, D-18): the low-level data client, the admin
 * client and the high-level `Firestore` class for listeners, all pointed at the emulator when
 * FIRESTORE_EMULATOR_HOST is set.
 */
@Injectable()
export class FirestoreClients {
  constructor(
    private readonly clients: GcpClientFactory,
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
  ) {}

  get emulator(): string | null {
    return this.config.emulators.firestore;
  }

  async data(profileId: string): Promise<DataClient> {
    const { v1 } = await sdk.firestore();
    const host = this.emulator;
    if (host) {
      const url = new URL(`http://${host}`);
      const client = this.clients.get(profileId, `firestore-data:${host}`, () => {
        const gax = firestoreGax();
        return new v1.FirestoreClient(
          { servicePath: url.hostname, port: Number(url.port || 8080), sslCreds: gax.grpc.credentials.createInsecure() },
          gax,
        );
      });
      return { client, opts: { otherArgs: { headers: { Authorization: 'Bearer owner' } } } };
    }
    return { client: this.clients.get(profileId, 'firestore-data', (auth) => new v1.FirestoreClient({ auth: auth as never })), opts: {} };
  }

  /** The admin API does not exist in the emulator (D-18). */
  async admin(profileId: string, feature: string): Promise<Any> {
    if (this.emulator)
      throw ProblemException.of('FAILED_PRECONDITION', `${feature} is not available in the Firestore emulator.`, {
        reason: 'EMULATOR_UNSUPPORTED',
      });
    const { v1 } = await sdk.firestore();
    return this.clients.get(profileId, 'firestore-admin', (auth) => new v1.FirestoreAdminClient({ auth: auth as never }));
  }

  /** The high-level class, for listeners (D-10). Integers stay BigInt so int and double differ. */
  async sdk(profileId: string, projectId: string, databaseId: string): Promise<Any> {
    const { Firestore } = await sdk.firestore();
    return this.clients.get(profileId, `firestore-sdk:${projectId}:${databaseId}`, (auth) => {
      const db = new Firestore({ projectId, databaseId, useBigInt: true, ...(this.emulator ? {} : { auth }) });
      // The factory closes idle clients with close(); Firestore calls it terminate().
      return Object.assign(db, { close: () => db.terminate() });
    });
  }
}
