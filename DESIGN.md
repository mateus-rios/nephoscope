---
name: Nephoscope
description: A local web console for Google Cloud, drawn as a drafting sheet.
colors:
  drafting-film: "oklch(0.968 0.005 220)"
  sheet: "oklch(0.984 0.003 220)"
  panel: "oklch(0.952 0.006 225)"
  well: "oklch(0.94 0.007 225)"
  hover: "oklch(0.925 0.008 228)"
  graphite-ink: "oklch(0.255 0.014 235)"
  graphite-ink-2: "oklch(0.42 0.014 235)"
  graphite-ink-3: "oklch(0.52 0.012 235)"
  hairline-rule: "oklch(0.875 0.008 230)"
  hairline-rule-strong: "oklch(0.63 0.014 230)"
  non-repro-blue: "oklch(0.66 0.09 240)"
  non-repro-tint: "oklch(0.925 0.035 240)"
  non-repro-ink: "oklch(0.45 0.11 245)"
  commit-blue: "oklch(0.5 0.19 262)"
  commit-blue-hover: "oklch(0.45 0.19 262)"
  commit-ink: "oklch(0.985 0.004 262)"
  redline: "oklch(0.55 0.19 27)"
  redline-hover: "oklch(0.5 0.19 27)"
  redline-tint: "oklch(0.955 0.025 27)"
  redline-ink: "oklch(0.47 0.17 27)"
  amber-warn: "oklch(0.64 0.14 66)"
  amber-warn-ink: "oklch(0.48 0.11 62)"
  green-ok: "oklch(0.6 0.13 155)"
  green-ok-ink: "oklch(0.43 0.1 155)"
  focus-blue: "oklch(0.55 0.15 245)"
  blueprint-film: "oklch(0.215 0.032 252)"
  blueprint-sheet: "oklch(0.235 0.034 252)"
  blueprint-ink: "oklch(0.935 0.012 240)"
  blueprint-rule: "oklch(0.33 0.035 250)"
  blueprint-commit: "oklch(0.7 0.15 262)"
  blueprint-redline: "oklch(0.68 0.17 27)"
typography:
  page:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  dense:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  meta:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  legend:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 560
    lineHeight: "14px"
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 75"
  data:
    fontFamily: "Martian Mono Variable, Martian Mono, ui-monospace, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  control: "4px"
  menu: "6px"
  dialog: "8px"
  pill: "9999px"
spacing:
  gutter: "24px"
  section: "36px"
  row: "32px"
  row-compact: "28px"
  row-comfortable: "40px"
  control: "32px"
  control-sm: "28px"
  control-lg: "36px"
components:
  button-commit:
    backgroundColor: "{colors.commit-blue}"
    textColor: "{colors.commit-ink}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-commit-hover:
    backgroundColor: "{colors.commit-blue-hover}"
    textColor: "{colors.commit-ink}"
  button-danger:
    backgroundColor: "{colors.redline}"
    textColor: "{colors.commit-ink}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  button-danger-hover:
    backgroundColor: "{colors.redline-hover}"
    textColor: "{colors.commit-ink}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite-ink}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.graphite-ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-ink-2}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite-ink}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "{spacing.control}"
  table-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite-ink}"
    typography: "{typography.dense}"
    height: "{spacing.row}"
  table-row-active:
    backgroundColor: "{colors.non-repro-tint}"
    textColor: "{colors.graphite-ink}"
---

# Design System: Nephoscope

## Overview

**Creative North Star: "The Drawing Sheet"**

Every Google Cloud resource is a drawing sheet. A title block states what the resource is and under which credential; a revision table says what changed; redline marks what is wrong or about to be destroyed. The world is drafting film with graphite ink and hairline rules, with non-repro blue for construction lines and secondary information. The dark theme is a blueprint: the same drawing, reversed onto deep navy.

The interface is dense inside a block and generous between blocks, and it is never boxed into cards. It is used for hours, mostly by keyboard, often during incidents, so it stays calm: one saturated color per view, and that color means "commit". Status always carries an icon and a word, never color alone. Project data is drawn as text, exactly as Google returned it.

Ink settles; it does not fly. Values that change live take a pale construction tint that fades over a second. Popups grow from their trigger at 97% scale; nothing a keyboard triggers animates.

**Key Characteristics:**
- Drafting film and graphite in light; blueprint navy in dark. Both are first-class, and both pass WCAG 2.2 AA.
- Hairline rules instead of boxes and shadows; depth only for things that float (menus, dialogs, sheets).
- One commit control per view, in commit blue; destruction in redline, behind a typed confirmation.
- Archivo for every role; Martian Mono only for ids, paths, code and data.
- Condensed uppercase legends label title blocks and table headers, like drafting lettering.

## Colors

A cool, nearly achromatic paper-and-graphite palette, with exactly one saturated voice per view and state colors that each mean one thing.

### Primary
- **Commit Blue** (commit-blue): the single committing control of a view: Deploy, Apply, Run, Save. It is never decoration, never a link color, never a selected state. Checkboxes and radios are graphite so that this blue keeps its meaning.

### Secondary
- **Non-repro Blue** (non-repro-blue, with non-repro-tint and non-repro-ink): construction and secondary information: the active row of a table, the live-value tint that settles over a second, text selection, the "running" state's icon and label.

### Tertiary
- **Redline** (redline, redline-tint, redline-ink): errors and destruction only. A failed state, a validation error, a delete button, the markup of what a change will remove.

### Neutral
- **Drafting Film** (drafting-film): the page background, behind every sheet.
- **Sheet** (sheet): the surface content sits on: tables, inputs, dialogs.
- **Panel** and **Well** (panel, well): recessed areas: code and log wells, the title block's cells, sticky bars.
- **Hover** (hover): pointer feedback on rows and secondary buttons.
- **Graphite Ink** (graphite-ink, graphite-ink-2, graphite-ink-3): primary text, secondary text, and legends or placeholders. The third step still passes AA on every surface.
- **Hairline Rule** (hairline-rule, hairline-rule-strong): the lines that divide everything; the strong rule outlines controls.

### State colors
- **Green OK** (green-ok, green-ok-ink): ready, succeeded, enabled.
- **Amber Warn** (amber-warn, amber-warn-ink): degraded, close to a limit, needs attention.
- Red is Redline; paused, pending and unknown are graphite.

### Blueprint (dark theme)
The dark theme swaps the film for **Blueprint Film** (blueprint-film) and **Blueprint Sheet** (blueprint-sheet), the ink for **Blueprint Ink** (blueprint-ink), and lifts commit and redline to **Blueprint Commit** and **Blueprint Redline** so they keep AA contrast on navy. Every token has a blueprint value; only the main ones are listed here.

### Named Rules
**The One Voice Rule.** Commit blue appears on at most one control per view. A second action is secondary or ghost. A dialog or sheet is its own view and may have its own commit.

**The Redline Rule.** Red means an error or a destruction, nothing else. A red badge for "new" or a red brand accent is forbidden.

**The Token Rule.** Colors exist only as tokens in `tokens.css`; Tailwind's default palette is removed, and a check fails the build on any other color literal.

**The Identity Is Not State Rule.** Profile color tags mark which credential is active; they never signal health.

## Typography

**Body Font:** Archivo (variable, with system-ui fallback)
**Data Font:** Martian Mono (variable, with Consolas fallback)

**Character:** Archivo carries every role, from the page title to the condensed legends; its width axis at 75% gives the drafting lettering. Martian Mono marks anything a machine produced: ids, paths, versions, code, logs and values.

### Hierarchy
- **Page** (600, 20px/28px, -0.01em): the title block's title, one per page.
- **Section** (600, 16px/22px): section headings below a hairline rule.
- **Body** (400, 14px/20px): reading text, descriptions, dialog copy; subtitles stop at 75ch.
- **Dense** (400, 13px/18px): table cells, controls, form text: the working size of the app.
- **Meta** (400, 12px/16px): help text, timestamps, counts.
- **Legend** (560, 11px/14px, 0.07em, uppercase, 75% width): title-block labels and table headers only.
- **Data** (Martian Mono, 11px to 12px): ids, resource names, code, log lines, query results.

### Named Rules
**The Legend Rule.** Uppercase condensed lettering is reserved for legends. Buttons, headings and body text are sentence case.

**The Machine Text Rule.** If Google produced it (an id, a path, a JSON value), it is set in Martian Mono and drawn as text, never as HTML.

## Layout

A 48px title strip runs across the top, with a 2px ribbon in the active profile's color beneath it; a product index runs down the left, grouped by discipline, with each product's keyboard shortcut; the page fills the rest. Pages have a 24px side gutter and 36px between sections. Tables run edge to edge with hairline rows of 32px (28px compact, 40px comfortable, chosen in the density setting). Detail pages share one layout: breadcrumb, title block with its cells, actions, then tabs whose state lives in the URL.

On narrow screens the side index and split panes stack, fields grow to the full width, and wide tables scroll inside their own region rather than the page. Desktop is the first target; phones must stay readable.

## Elevation & Depth

Flat by default. Depth is drawn with hairline rules and the step from film to sheet to well, not with shadows. Only things that float above the sheet (menus, popovers, tooltips, dialogs and side sheets) take the single overlay shadow, and a dimmed overlay sits behind modal views.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 1px 2px var(--shadow-color), 0 8px 24px -6px var(--shadow-color)`): menus, popovers, dialogs, sheets, and a dragged row while it moves.

### Named Rules
**The No Cards Rule.** Content is never wrapped in raised cards. A group is a section with a heading and a rule.

## Shapes

Small, technical corners: 4px on controls, 6px on menus, 8px on dialogs; pills only for switches and counters. Borders are hairlines, one pixel. Focus is a 2px focus-blue outline, offset by 2px, following the control's corner.

## Components

### Buttons
- **Shape:** squared with a 4px corner, 32px tall (28px small, 36px large), sentence case.
- **Commit:** commit blue fill with near-white text; one per view.
- **Danger:** redline fill, for the confirming button of a destruction; the dialog asks for the resource name typed first.
- **Secondary:** sheet fill with a strong hairline; hover lifts to the hover tone.
- **Ghost:** no fill or border; graphite-2 text that darkens on hover. Used for row actions.
- **Hover / Press:** colors change in 150ms on an ease-out curve; a press scales to 97% and back. A disabled button explains why in a tooltip.

### Inputs / Fields
- **Style:** sheet fill, strong hairline border, 4px corner, 32px tall; the label sits above and help text below.
- **Focus:** the 2px focus-blue outline.
- **Error:** the border turns redline and the help line is replaced by the error in redline ink.

### Title block
The head of every page: the title in Page type with its status glyph, a subtitle, the actions, and a row of cells (legend above, value below) divided by hairlines, like the title block of a drawing.

### Tables
Hairline-ruled rows at the row height, legends as headers, sortable columns, a filter field and facets above. The active row takes the non-repro tint. Lists that can grow page in place or window their rows.

### Status glyph
An icon and a word together: check (OK), triangle (warning), cross (error, redline), turning circle (running, non-repro), hollow circle (pending), pause (paused), question mark (unknown). The running icon stops turning under reduced motion.

### Dialogs and sheets
Dialogs center and grow from 97% with a fade; side sheets slide in from the right on the drawer curve. Both trap focus, close on Escape, and return focus to their trigger. Exits are faster than entrances.

## Do's and Don'ts

### Do:
- **Do** keep one commit-blue control per view and make every other action secondary or ghost.
- **Do** pair every state color with its icon and a word.
- **Do** set ids, paths, code and values in Martian Mono, as text, exactly as Google returned them.
- **Do** put a typed confirmation of the resource name in front of every destruction, with the equivalent command shown.
- **Do** use the non-repro tint, fading over one second, to show that a live value just changed.
- **Do** honor reduced motion: popups keep their fade, lose their scale; spinners stop.

### Don't:
- **Don't** use red for anything but errors and destruction.
- **Don't** wrap content in cards, add colored top bars, or build dashboards of metric tiles.
- **Don't** animate anything triggered by a keyboard shortcut or repeated many times a minute.
- **Don't** grow a popup from 0 or from the center of the screen; it grows from its trigger at 97%.
- **Don't** add a color outside `tokens.css`, or reuse a profile tag color to mean state.
- **Don't** imitate Google's visual identity or use Google's product icons.
