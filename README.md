# Nephoscope

A Google Cloud console that runs on your machine, with your own keys. Mount a service account key
(or your gcloud credentials), open `http://localhost:8080`, and browse and operate your projects.

Nephoscope is one Docker container: a NestJS API that talks to Google through the official Node SDKs,
and a web app served from the same port. Keys stay on your machine, encrypted at rest, and never
reach the browser.

> **Nephoscope has no login.** Anyone who can reach its port acts with your keys. Always publish the
> port on `127.0.0.1` only, as every command below does.

Nephoscope is an independent open-source project, licensed under [Apache-2.0](LICENSE). It is not
affiliated with, endorsed by, or sponsored by Google. Google Cloud and the names of its products are
trademarks of Google LLC and appear here only to say what Nephoscope works with.

- [Quick start](#quick-start)
- [Running it without compose](#running-it-without-compose)
- [Keys and profiles](#keys-and-profiles)
- [What the key needs](#what-the-key-needs)
- [Emulators](#emulators)
- [What works today](#what-works-today)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Quick start

You need Docker (Docker Desktop on Windows and macOS) and a Google Cloud key JSON file.

1. Copy `.env.example` to `.env` and set `GCP_KEY_FILE` to the path of your key:

   ```ini
   # macOS or Linux
   GCP_KEY_FILE=/Users/you/keys/sandbox.json
   # Windows: forward slashes work, and so do backslashes
   GCP_KEY_FILE=C:/Users/you/keys/sandbox.json
   ```

2. Build and start:

   ```sh
   docker compose up --build
   ```

3. Open <http://localhost:8080>. The key appears as the **Environment** profile; pick a project.

Stop with `Ctrl+C`, or `docker compose down`. Saved profiles, preferences and the activity log
live in the `nephoscope-data` volume and survive restarts. `docker compose down -v` deletes them.

## Running it without compose

Use the published image, or build your own. In the commands below, replace `nephoscope` with the
published name, `masanrios/nephoscope`, to skip the build. The published image runs on
`linux/amd64` and `linux/arm64` (Apple Silicon included).

```sh
docker pull masanrios/nephoscope   # the published image
docker build -t nephoscope .       # or build it from this repository
```

Then run it with a key. The flags keep the port on loopback, mount the key read-only and keep the
container's file system read-only.

macOS and Linux:

```sh
docker run --rm -p 127.0.0.1:8080:8080 --read-only --tmpfs /tmp \
  -v "$HOME/keys/sandbox.json:/secrets/key.json:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/key.json \
  -v nephoscope-data:/data nephoscope
```

Windows, PowerShell:

```powershell
docker run --rm -p 127.0.0.1:8080:8080 --read-only --tmpfs /tmp `
  -v "C:\Users\you\keys\sandbox.json:/secrets/key.json:ro" `
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/key.json `
  -v nephoscope-data:/data nephoscope
```

Windows, Git Bash: Git Bash rewrites paths that start with `/`, which breaks `/secrets/key.json`.
Prefix the command with `MSYS_NO_PATHCONV=1`, or use PowerShell.

Without any key, leave out the `-v …key.json` and `-e GOOGLE_APPLICATION_CREDENTIALS` lines and add
keys in the app instead.

Never use a bare `-p 8080:8080`: Docker then publishes the port on every network interface.

## Keys and profiles

Nephoscope acts with a **profile**, which is one key. Each browser tab acts with one profile, chosen in
the top right, so two tabs can work with two keys side by side.

- **Environment**: the key in `GOOGLE_APPLICATION_CREDENTIALS` when the container starts. It
  cannot be edited or deleted in the app.
- **Saved profiles**: keys you add under **Connections**, by dropping or pasting the JSON. Nephoscope
  checks the key, asks Google for a token and lists what it can see before saving it.

Supported keys: service account keys, gcloud user credentials (`application_default_credentials.json`),
workload identity federation configurations, and impersonation configurations.

Each profile can be:

- **Read-only**: Nephoscope refuses every change to Google Cloud while you act with it. Use it for
  production keys. `NEPHOSCOPE_READ_ONLY=true` makes the whole instance read-only.
- **Color tagged**: the color runs as a ribbon under the title strip, so you always know where you are.

Saved keys are encrypted with AES-256-GCM. The encryption secret is generated in the data volume on
first start. To keep it elsewhere, set `NEPHOSCOPE_SECRET` (16 characters or more); changing it later
makes the saved profiles unreadable, and Nephoscope offers to reset them.

Every change made through Nephoscope, and every change it refused, is listed under **Activity**. The log
stays in the data volume.

## What the key needs

Nephoscope shows what the key may do and greys out the rest, naming the missing permission. As a guide:

| To | Grant |
| --- | --- |
| Browse a project | Viewer (`roles/viewer`) |
| Enable and disable APIs | Service Usage Admin (`roles/serviceusage.serviceUsageAdmin`) |
| Search resources from the command palette | Cloud Asset Viewer (`roles/cloudasset.viewer`), with the Cloud Asset API enabled |
| Use Colab Enterprise: notebooks, runtimes, runs and schedules | Colab Enterprise User (`roles/aiplatform.colabEnterpriseUser`), plus write access to the bucket runs write to |
| Manage runtime templates | Colab Enterprise Admin (`roles/aiplatform.colabEnterpriseAdmin`) |
| Operate a product | That product's admin or developer role |

Start with a sandbox project and a read-only profile until you trust a workflow.

## Emulators

For local work without a Google project, the `emulators` compose profile starts the Firestore
emulator (native and Datastore mode), the Pub/Sub emulator and fake-gcs-server for Cloud Storage.
Uncomment the emulator variables in `.env`, then:

```sh
docker compose --profile emulators up --build
```

The project home lists which products talk to an emulator.

No key is needed to try Firestore this way. With an emulator configured and no key, the
Environment profile reaches only the emulators; open `/p/any-project-id/firestore`, since the
emulators accept any project id. Without Docker, the Firebase CLI's Firestore emulator works too
(it needs Java):

```sh
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v*.jar --host=127.0.0.1 --port=8085
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v*.jar --host=127.0.0.1 --port=8086 --database-mode=datastore-mode
java -jar ~/.cache/firebase/emulators/pubsub-emulator-*/pubsub-emulator/lib/cloud-pubsub-emulator-*-all.jar --host=127.0.0.1 --port=8087
fake-gcs-server -scheme http -host 127.0.0.1 -port 8088 -backend memory -public-host 127.0.0.1:8088
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 DATASTORE_EMULATOR_HOST=127.0.0.1:8086 PUBSUB_EMULATOR_HOST=127.0.0.1:8087 STORAGE_EMULATOR_HOST=127.0.0.1:8088 pnpm dev
```

(`firebase setup:emulators:firestore` and `firebase setup:emulators:pubsub` download them once;
fake-gcs-server comes from its [releases](https://github.com/fsouza/fake-gcs-server/releases).)
fake-gcs-server has no IAM, signed URLs or hierarchical folders, and it drops lifecycle rules, CORS
and labels; Nephoscope says so where it matters.

## What works today

Milestones M0 to M2, Pub/Sub and Cloud Storage from M4, and Colab Enterprise:

- **Cloud Run** services and jobs: deploy revisions, split traffic, roll back, run jobs with
  overrides, live executions, logs and metrics.
- **Functions** (every generation), **Workflows** (editor with validation, step graph, executions),
  **Cloud Scheduler**, **Cloud Tasks** and **Eventarc**.
- **Firestore**: browse and edit with exact types (integers, doubles, timestamps to the
  nanosecond), diffs before every save, a query builder with OR groups, cursors, vector search,
  aggregations and Explain, one-click missing indexes, live mode, import and export, indexes, TTL,
  backups, rules with a playground, and Datastore mode with GQL.
- **Pub/Sub**: topics and every subscription type, publishing (one message or an NDJSON file),
  safe peeking, live watching through a temporary subscription, dead-letter inspection and
  resend, snapshots and seek, and schemas with validation.
- **Cloud Storage**: buckets with every setting (lifecycle rules, CORS, versioning, soft delete,
  retention and its lock, website, requester pays, IAM), an object browser with folders, versions
  and soft-deleted objects, drag-and-drop uploads of files and folders, streamed downloads with
  range requests, previews that never run what they show, metadata and holds, copy, move and
  rename, and signed URLs when the key can sign.
- **Colab Enterprise**: notebooks with their cells, outputs and every saved version, uploads of a
  new version that never overwrite someone else's save, runtimes and runtime templates, runs with
  the executed notebook read back from Cloud Storage, and schedules with pause, resume and catch-up.
  Nephoscope does not run kernels; editing and interactive runs stay in Colab.
- **Projects**: every project the key can see, and a project home with every product, its API state
  and what the key may do in it.
- **APIs & Services**: enabled and available APIs, enable and disable, with progress in the
  operations tray.
- **Connections**: add, test, edit and delete keys.
- **Activity**: the audit log.
- The command palette (`Ctrl K`), keyboard shortcuts (`?`), light and dark themes, three densities.

Next come observability (M3), Filestore, security and delivery, data and compute, and a raw API console. The plan
and every decision live in [docs/specs](docs/specs/README.md) (in Portuguese).

## Development

Requirements: Node 24 and pnpm 11 (`corepack enable` sets it up from `package.json`).

```sh
pnpm install
pnpm dev          # API on 127.0.0.1:8080, web app with hot reload on http://127.0.0.1:5173
pnpm check        # lint, typecheck, unit tests and the design gates
pnpm --filter @nephoscope/web e2e     # browser tests against a mocked API
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 DATASTORE_EMULATOR_HOST=127.0.0.1:8086 PUBSUB_EMULATOR_HOST=127.0.0.1:8087 STORAGE_EMULATOR_HOST=127.0.0.1:8088 pnpm --filter @nephoscope/api test:emulator
```

`pnpm dev` reads the key from `GOOGLE_APPLICATION_CREDENTIALS` in your shell, falling back to your
gcloud application default credentials. Data goes to `.nephoscope-data/` unless `NEPHOSCOPE_DATA_DIR` is set.

| Path | What |
| --- | --- |
| `apps/api` | NestJS API: credentials, security, Google clients, product modules |
| `apps/web` | React app; `/_kit` shows every component in both themes (development only) |
| `packages/contracts` | Schemas and types shared by both, including the product registry |
| `docs/specs` | The specs: the source of truth for behavior |
| `scripts/check-tokens.mjs` | Design gate: no raw colors, no em dashes, AA contrast in both themes |

When you change behavior, update the matching spec and its revision history in the same change.

## Troubleshooting

**The page says "Host not allowed" (421).** Open Nephoscope as `localhost` or `127.0.0.1`. To reach it
under another name, add the name to `NEPHOSCOPE_ALLOWED_HOSTS`; Nephoscope then prints a one-time access
token URL in its log, and the browser keeps the token.

**The Environment profile is missing.** Connections says why the key could not be loaded. On Linux,
`EACCES: permission denied` means the container's `node` user (uid 1000) cannot read the mounted file. Grant it read access
without widening it to everyone: `setfacl -m u:1000:r key.json`.

**"Saved profiles cannot be decrypted".** `NEPHOSCOPE_SECRET` changed, or the data volume was restored
without its `.secret` file. Restore the old secret, or reset the saved profiles under Connections.

**"Preferences last only until Nephoscope restarts".** The data directory is not writable. With compose
this should not happen; with `docker run`, keep the `-v nephoscope-data:/data` line.

**Port 8080 is taken.** Set `NEPHOSCOPE_PORT=8090` in `.env`, or use `-p 127.0.0.1:8090:8080`.

## License

Nephoscope is licensed under the [Apache License, Version 2.0](LICENSE); see also [NOTICE](NOTICE).
It includes third-party software under its own licenses, listed with their texts in
`THIRD_PARTY_NOTICES.txt`. That file is generated by `pnpm notices` and by every build; the image
carries it at `/app/THIRD_PARTY_NOTICES.txt`, and the app serves it at `/third-party-notices.txt`
(Settings, Open-source licenses).

### Publishing the image

One build serves both platforms: the build stages run on the build machine, and only the final
stage is assembled per platform. Log in with `docker login`, then:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg VERSION=0.1.0 --build-arg REVISION=$(git rev-parse HEAD) \
  -t masanrios/nephoscope:0.1.0 -t masanrios/nephoscope:latest --push .
```

The image declares its license, version, commit and source repository in OCI labels. Keep the "not
affiliated with Google" sentence in the Docker Hub description.

