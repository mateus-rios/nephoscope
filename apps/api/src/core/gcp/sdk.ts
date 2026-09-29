/**
 * Google SDKs load on first use, not at startup (SPEC-0001 D-23, CA-74): each generated client
 * parses its protocol definitions when imported, which costs seconds and tens of megabytes.
 */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

export const sdk = {
  run: lazy(() => import('@google-cloud/run')),
  runRest: lazy(() => import('@googleapis/run')),
  functions: lazy(() => import('@google-cloud/functions')),
  workflows: lazy(() => import('@google-cloud/workflows')),
  workflowExecutionsRest: lazy(() => import('@googleapis/workflowexecutions')),
  scheduler: lazy(() => import('@google-cloud/scheduler')),
  tasks: lazy(() => import('@google-cloud/tasks')),
  eventarc: lazy(() => import('@google-cloud/eventarc')),
  logging: lazy(() => import('@google-cloud/logging-api')),
  monitoring: lazy(() => import('@google-cloud/monitoring')),
  artifactRegistry: lazy(() => import('@google-cloud/artifact-registry')),
  // Its CommonJS exports are getters, which Node's ESM loader does not see as named exports.
  firestore: lazy(() => import('@google-cloud/firestore').then((m) => ((m as unknown as { default?: typeof m }).default ?? m) as typeof m)),
  firebaseRules: lazy(() => import('@googleapis/firebaserules')),
  datastore: lazy(() => import('@google-cloud/datastore')),
  pubsub: lazy(() => import('@google-cloud/pubsub')),
  storage: lazy(() => import('@google-cloud/storage')),
  storageControl: lazy(() => import('@google-cloud/storage-control')),
};
