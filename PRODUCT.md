# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 single-page app built with Vite (Tailwind CSS v4, Base UI primitives), served by a NestJS 12 API from the same Docker container. Chosen by the owner during planning; see `docs/specs/0001-platform.md` and `docs/specs/0002-design-system.md`.

## Users

Engineers and operators, the owner and teammates, who work on Google Cloud projects through credential files: service account keys, gcloud user credentials, workload identity configurations. Each person runs their own Nephoscope on their own machine, with their own keys.

The job: inspect, operate and debug workloads (Cloud Run services and jobs, functions, Workflows, Scheduler, Firestore, logs, and the rest of the catalog) without the Google Cloud console, which only works with a Google account session.

## Product Purpose

Nephoscope turns a credential file into a full web console for Google Cloud. Mount a key, run one container, open `localhost:8080`.

Success means daily work on the core products (Cloud Run, functions, Workflows, Scheduler, Firestore) happens in Nephoscope, with the safety rails of a console, without switching to `gcloud` or the Google console.

## Positioning

- Works from any credential, not a Google account session, and switches between several keys (profiles) without restarting.
- Adapts to what the active key can do: shows disabled APIs and missing permissions before the user tries an action, and offers the fix.
- Runs locally, in one container, with nothing deployed to the cloud and no telemetry.
- Goes deeper than the Google console on selected tools: lossless Firestore typing and live queries, safe Pub/Sub peeking, cost-first BigQuery, shared live log tails within Logging quotas.

## Operating Context

- A developer laptop or workstation running Docker (Windows, macOS or Linux), with Nephoscope open in a browser tab at `localhost:8080`, often in several tabs at once.
- Used for hours at a time, keyboard-heavy, often while debugging an incident.
- The same person holds keys for several projects and environments (production and development), so confusing one profile for another is a real risk.
- Teammates set up their own copy from the README, so setup must work without the owner's help.

## Capabilities and Constraints

- Local only, no login: the port is published on `127.0.0.1`. Local-web-app hardening applies (Host allowlist, client header, origin checks, access token outside loopback).
- Credentials: the environment key plus saved profiles, encrypted at rest, each optionally read-only and color-tagged. Private keys never reach the browser.
- Every change to Google Cloud is audited locally; destructive actions require typing the resource name.
- All assets are bundled; the app works without any third-party network access besides Google APIs.
- English UI. Desktop first, readable on phones.
- Product scope and milestones (M0 to M7) are defined in `docs/specs/`, the source of truth for behavior.
- Not decided: a sandbox project for live verification (SPEC-0001 Q-02).

## Brand Commitments

- Name: Nephoscope (confirmed).
- No existing logo, palette or visual identity.
- Must not imitate Google's visual identity or use Google's product icons or logos. Google product names are used descriptively.

## Evidence on Hand

No users, screenshots, testimonials or metrics exist yet; none may be invented. The specs in `docs/specs/` describe intended behavior.

## Product Principles

1. **Truth over decoration.** Show exactly what Google Cloud reports, with exact types, precise errors and real state.
2. **Safe by default.** The dangerous action is always the deliberate one: typed confirmations, read-only profiles, an unmistakable active profile.
3. **Calm density.** A lot of information with little noise; the tool disappears into the task.
4. **Fast in the hands.** Keyboard first, no waiting on animation, a deep link for every view.
5. **Honest about limits.** When a key cannot do something or an API is off, say so and offer the fix.

## Accessibility & Inclusion

WCAG 2.2 AA in both light and dark themes. Fully usable by keyboard. Reduced motion honored. Status is never conveyed by color alone.
