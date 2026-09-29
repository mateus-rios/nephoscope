---
version: 1
slug: "apps-web-src-app-shell-tsx"
primary_target: "apps/web/src/app/Shell.tsx"
related_targets: ["apps/web/src"]
---

## Scope

The Nimbus application shell (title strip, product index, command palette, operations tray, profile and project switching) and the project home. Every later product surface inherits this world. Visitor mode: Operate.

## Audience and task

Engineers and operators working from credential files, often several keys and projects at once, for hours, frequently during incidents. On this surface they confirm which key and which project they are acting in, see what the key can do in the project, and move to a product fast, mostly by keyboard.

## Direction contract

THESIS: Every Google Cloud resource is a drawing sheet: a title block states what it is and under which credential, a revision table says what changed, redline marks what is wrong or about to be destroyed. It refuses the cloud-console default of a colored top bar, an icon rail and a dashboard of cards.

OWN-WORLD: Drafting film with graphite ink, hairline rules, non-repro blue for construction and secondary information, redline only for errors and destruction, one saturated commit color per view; blueprint navy for the dark theme. Archivo carries every role, condensed and uppercase only for legends (title-block labels, table headers); Martian Mono only for ids, paths, code and data. Raises: one committing control per view (hardware bench); a profile mark generated from each key (seeded identity); palette law, one meaning per state color (arcade); dense inside a block, generous between blocks, never boxed (cloud quarry); a chosen revision or time range propagates to every linked panel (Miura fold).

STORY: The engineer reads the title strip to confirm key and project, scans the bill of materials to learn what this key can do here, and commits only through the one commit control, having seen in redline exactly what will change.

FIRST VIEWPORT: A 48px title strip across the top: the Nimbus mark and the sheet title (project name and id) at left, the project field at center, the profile block at right (generated mark, principal, read-only stamp) with the operations tray; a 2px ribbon in the profile's color beneath it. A product index down the left, numbered like a parts list and grouped by discipline. The project home fills the rest as a bill of materials: item, product, API state, what this key can do, notes; a numbered general-notes block for conditions (API status unknown, read-only, quota project). No hero, no cards, no metrics tiles.

FORM: Engineering drawing sheet (ISO and ANSI practice), position 5 of the ordered list, seed key ac8393d6.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction

Redline preview: before any commit, the sheet shows in redline exactly what will change, marks each edited field with a revision triangle, and the single commit control states the consequence ("Deploy revision · 3 changes").

## Motion grammar

Ink settles, it does not fly. Values that change live take a tint that fades over one second; nothing moves. Diagrams may draw their lines once, like a plotter, on first mount of a rarely visited view. Keyboard and high-frequency actions never animate (SPEC-0002 D-10).

## Unresolved

Exact OKLCH values and the type scale are tuned during the build and recorded in DESIGN.md at finish.
