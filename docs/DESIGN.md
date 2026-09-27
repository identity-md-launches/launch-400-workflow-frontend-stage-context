# Stoploss design system

## Overview

This is a single-page Sepolia order desk for STOP holders. Warm off-white surfaces and a dark green header frame plain transaction forms. Lime fill identifies the primary placement or confirmation action. Price, escrow and current tick precede the forms; explanations follow the working controls. No price history, decorative chart or invented market activity is shown.

The implementation is `web/src/App.tsx` and `web/src/styles.css`. This document is under `docs/` because the assignment's overriding write scope prohibits a repository-root DESIGN.md. It describes the delivered source and observed export, not a proposed redesign.

## Colors

Canonical tokens are in `web/src/styles.css:1` and use hex. Only the implemented light theme is supported.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f5ee` | Page canvas |
| `--surface` | `#fffef9` | Panels, inputs, dialog |
| `--surface-muted` | `#eeefe6` | Insets, estimates, disabled buttons |
| `--text` | `#192a21` | Main content |
| `--muted` | `#5d685f` | Hints, secondary content |
| `--border` | `#d6dbce` | Structural separators and panel boundaries |
| `--input-border` | `#87917f` | Interactive field/button boundaries |
| `--forest` / `--on-accent` | `#14281e` | Header background / lime-button text |
| `--accent` | `#cef276` | Primary action fill and brand mark |
| `--accent-hover` | `#bde65e` | Primary hover fill |
| `--inverse` | `#f6f8ed` | Header text |
| `--error` / `--error-bg` | `#963b28` / `#fff0e8` | Error text / notice surface |
| `--warning` | `#73551e` | Wrong-network text and disconnected status dot |
| `--focus` | `#476623` | Focus outlines and level-volume bars |

Specific treatments: testnet pill `#e5ebd7`; warning surface `#f6edce`; header button border `#7d8d7a`, hover `#2d4235`; header mobile separator `#405044`; dialog backdrop `#14281e99`. Status is always accompanied by words. The level bars supplement numeric amounts.

Measured rendered pairs are in `docs/evidence/rendered-checks.json`: body/page 13.75:1; panel hint/surface 5.76:1; disabled primary/muted surface 5.02:1; header brand/forest 14.47:1; pill 12.33:1; field label/surface 14.91:1. These are the specific measured pairs, not a claim about every possible state. Axe scans cover the tested connected, empty and dialog states.

## Typography

The CSS family is `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No font is fetched or bundled. System fallbacks render when Inter is not installed; the exact installed face varies by platform. Monospace is used for complete identifiers. `font-synthesis: none` and root font smoothing are set.

The main heading uses `clamp(2.5rem, 4.5vw, 3.9rem)`, weight 500, line-height 1.06 and tracking -0.06em; the narrowest breakpoint sets 2.375rem. Section headings use 1.5rem/1.2, weight 600 and tracking -0.035em. The explanatory section heading is 1.875rem, weight 500. Body defaults to 1rem/1.5. Form copy uses 0.875rem, hints `--small: 0.8125rem` with 1.55 line-height, and compact metadata 0.75rem. Eyebrows use 0.6875rem, 650 weight, 0.13em tracking and CSS uppercase.

Inputs remain at least 1rem; amount fields are 1.625rem (1.375rem at the smallest width). Prices, balances and amounts use tabular numbers. Headings balance their wrapping; paragraphs use pretty wrapping. Descriptions are capped at 38–70ch. Full addresses are available in the deployment disclosure and wrap anywhere. No essential identifier depends solely on a tooltip.

## Layout

`main` is at most 1200px, centered with 28px inline padding. The header content aligns with that width. Desktop overview is a three-column grid. `.workspace` contains order and swap panels in a 1.2:1 ratio with 24px gap. Panels use 28px padding; related hints sit 9px below controls, major field groups use 23px top spacing, and section panels are separated by 24px. Most button targets have a 44px minimum height; compact contextual controls remain at least 32px high.

Breakpoints are 62rem, 46rem and 24rem:

- At 62rem: panel padding becomes 22px, the workspace gap 18px, and order-step buttons stack to preserve readable labels.
- At 46rem: header navigation wraps, the network is repeated visibly in the introductory testnet label, workspace becomes one column, order rows become two columns, and the explanatory/disclosure areas stack. Main padding becomes 20px. Desktop testnet side content is removed; the page still identifies Sepolia testnet.
- At 24rem: main padding becomes 16px, panels 18px, step buttons and level rows stack, and the tick metric moves below the other two metrics. Dialog buttons stack.

All transaction controls stay in normal flow. There is no sticky header obscuring anchor targets. Connected and empty exports were checked at 1440, 820, 390 and 320 CSS pixels with no document overflow; 200% CSS text enlargement was checked separately. This is not a native zoom or physical-device claim.

## Elevation & Depth

The system is flat: background tones and structural borders distinguish panels, with no card shadows. The modal uses the browser top layer and a translucent backdrop; the native dialog makes the rest of the document inert. There are no floating tooltips or nested overlay stacks.

## Shapes

`--radius: 18px` defines panels and the dialog. Buttons/inputs use 9px, grouped amount fields and insets 10px, the preview 8px, and compact pills 5px. Token marks are circular. The logo mark is a small rounded square rotated -5 degrees. Structural lines are 1px; focus uses a 3px perimeter with 4px offset (2px for inputs, zero inside the grouped amount field). Forced-colors mode uses system Highlight for focus.

## Components

These are source-local patterns rather than an exported component library:

| Component/pattern | Source | States and reuse |
| --- | --- | --- |
| `AddressLink` | `web/src/App.tsx` | Explorer destination from runtime configuration; descriptive label and decorative arrow; new-tab links retain browser behavior |
| `.panel`, `.panel-heading` | `web/src/styles.css` | Shared order, swap, level and history surfaces; wrap heading/action groups |
| `.amount-field`, `.field-heading`, `.hint` | CSS + `Desk` forms | Persistent labels; decimal keyboards; inline errors with `aria-describedby`; native validation is replaced by exact bigint checks |
| `.steps`, `button.primary` | CSS + order form | Separate approval and placement; readiness and allowance determine enabled state; disabled explanation remains visible |
| `.segmented` | Swap form | Two native buttons with `aria-pressed`; buy/sell changes invalidate quotes |
| `.order-row`, `.level-row` | `Desk` | On-chain amounts, state words and owner actions; cancelled/claimed orders have no action; mobile rows reflow |
| `.notice`, `.field-error` | `Desk` + CSS | Persistent recovery text; alerts for errors; no dismissing a transaction result automatically |
| Native `dialog` | `Desk` review | Title and description associations; initial focus on Go back; Escape and focus return; confirm locked while pending; link to submitted transaction |
| Deployment `details` | `Desk` | Native keyboard disclosure exposes source commit, attestation, addresses and manifest |

Loading, disconnected, wrong-chain, empty, failed verification, failed logs, rejection, simulation error, submitted and confirmed states are implemented. Amount/tick validation focuses the erroneous order field. Dynamic transaction messages use status regions. The first keyboard target is Skip to content.

Motion is limited to button background/scale transitions (120ms), enabled only under `prefers-reduced-motion: no-preference`; pressing scales to 0.96. Hover styling is limited to hover-capable devices. No entrance animation, chart animation, autoplay or theme transition exists.

## Do's and Don'ts

- Reuse panel, field and status patterns, and read deployment values through `Config`.
- Keep transaction reviews precise about token units, spender, network and consequence.
- Use the lime-filled action only for the current primary commitment; keep secondary actions outlined.
- Preserve explicit failure and empty states; never present missing RPC data as a zero balance.
- Preserve semantic form controls and native dialog behavior when adding actions.
- Do not label a quote a guaranteed output, add a second address map, or hide the testnet context on mobile.

A future page should start with the same header, centered main, panel patterns, semantic headings and status regions. Extend existing tokens only for a real missing role. Static hosting should continue using exported pages or hash/anchor navigation without server rewrites.

Design guidance: Jakub Krehel, Better Interface (MIT), pinned `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus, Impeccable (Apache-2.0), pinned `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Attribution and source links are in `web/README.md`.
