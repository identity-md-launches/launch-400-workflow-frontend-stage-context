# Frontend validation — Stoploss

Date: 2026-09-27. Worker-authored evidence; these results are not independent certification or publication checks.

## Scope and decisions

Delivered Vite + React + TypeScript source/configuration/lockfile in `web/`, a ready-to-commit static export in root `dist/`, and documentation/evidence in `docs/`. No contract, library, root configuration, deployment, or publishing changes. The only ignore-file budget is **one file: `web/.gitignore`**, explicitly allowed by the assignment; its basename patterns exclude dependency/cache directories at every nesting level under `web/`.

The overriding write scope prohibits root DESIGN.md, so the complete required design-system document is `docs/DESIGN.md`. The approved workflow specifically requires PoolSwapTest; it takes precedence over the generic Universal Router example. The network object is unchanged; the workflow-specific router is an additional centralized manifest integration. Its direct token approval and sqrt price-limit semantics are documented in the UI and README. No output-floor or deadline capability is invented.

Read inputs: workflow, deployment and network handoffs, all six Better Interface core domains plus workflow/documentation sections, both protected Solidity floor suites, implementation source, and pinned ABI exports. The Solidity floors were read for context, not rerun as frontend proof. The deployed source commit is `a866a595f27e6c610198ac45c135ec60b56f77e6`.

## Build and artifact verification

Commands run from the repository root unless shown otherwise:

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm install --prefix web --cache /tmp/stoploss-npm-cache --no-audit --no-fund` | Passed; lockfile v3 generated; exact frontend versions | `web/package-lock.json` |
| `npm --prefix web run typecheck` | Passed (exit 0) | `docs/evidence/typecheck.txt` |
| `npm --prefix web run build` | Passed (exit 0), Vite production export followed by manifest generation | `docs/evidence/build.txt` |
| `npm --prefix web run verify:export` | Passed (exit 0) | `docs/evidence/export-verification.txt` |
| `CHROMIUM_PATH=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm --prefix web test` | 12 tests passed | `docs/evidence/interaction-tests.txt` |
| Development server smoke check | HTML, source, manifest and both implementation ABIs return HTTP 200 | `docs/evidence/development-preview.txt` |

The build obtains raw implementation ABI arrays with `git show` from the deployed commit. Canonical Keccak results match the handoff:

- STOP: `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee`
- StopLossHook: `4506bc54a1fc6fe51a51e0c43b91fe38952b56e6e4866cbcfdaad835e4d5b74d`

The final export has nine declared assets, including index.html, two implementation ABI files, three external interface ABI files, CSS and two JavaScript chunks. The manifest is excluded from its own inventory. All declared SHA-256 hashes, contract identifiers, attestation, source commit, addresses, network values and wallet-add-chain parameters were compared. The export is approximately 546 KB; the exact final count is in export-verification.txt. There are no external fonts, CDN runtime scripts, npm registry mirrors, dependency archives or submodules added. Git submission size and path audit are recorded in `docs/evidence/submission-audit.txt`.

## Interaction checks

Playwright drives the **production export** at `http://127.0.0.1:4173/preview/`. The automated suite uses mocked EIP-1193 wallet responses and ABI-encoded RPC responses; all submitted transactions in that suite are in-memory fixtures. It validates:

1. Static subpath assets, disconnected/empty states, missing-wallet recovery, four viewport widths and an axe scan.
2. Wrong-network disabled actions; switch → 4902 → exact add-chain parameters → switch; account change clears the old wallet's orders.
3. Invalid amount/tick focus and messages, precise approval amount/spender, placement, cancellation, proportional ETH + unsold STOP claim, and permissionless execute(5).
4. Native buy with value/no approval, token sell with direct PoolSwapTest approval, negative exact input, both directional sqrt limits, V4Quoter eth_call and correct router destination.
5. Wallet rejection and failed simulation prevent sending; meaningful revert details; tolerance validation and input-driven quote invalidation.
6. No deployed code disables transactions; failed event indexing does not display a false zero or allow catch-up execution.
7. Tampered implementation ABI blocks boot.
8. Keyboard dialog entry, Escape, focus restoration; 200% CSS text enlargement without document overflow.
9. Connected screenshots, rendered color measurements, zero captured console/resource failures, dialog axe scan and reduced-motion transition duration of 0s.
10. Decimal precision, minimum/maximum amount and signed tick boundaries.
11. Bigint price limits with the correct ETH-per-STOP direction.
12. Adaptive RPC event ranges and replacement of reorganized recent logs.

Receipt confirmation, submitted explorer links, cancelled/claimed status and disabled dependent controls are checked during the transaction flows. The suite is designed to validate the frontend, not to retest Solidity economics. Deep reorganizations, very long historical sessions, real wallet-extension behavior and final on-chain settlement remain untested.

## Live read-only observations

Shell RPC probes returned HTTP 403 on all three configured public endpoints. The supplied browser could reach the primary configured RPC, and the actual app completed its verification and live reads without a mock. At 2026-09-27T07:36:19.779Z:

- `eth_chainId` returned `0xaa36a7` (11155111).
- Nonempty code: STOP 1,722 bytes; StopLossHook 13,305; PoolSwapTest 6,950; StateView 3,531; V4Quoter 5,820; PoolManager 24,009.
- The app's hook/router/lens/quoter manager-binding reads matched the configured PoolManager.
- Live StateView tick was 177284, with approximately 0.00000002 ETH per STOP. The event-derived book had no open levels.
- A read-only V4Quoter eth_call for 0.0001 ETH returned 4962.98560106950528639 STOP and a gas estimate of 103829. This was an observation at that time, not a current price promise or a broadcast swap.

Raw response summary: `docs/evidence/live-rpc.json`. Tool browser screenshots: `desktop-live.png` and `mobile-live.png`; live accessibility snapshot: `browser-live-mobile.yml`; console capture: `browser-console.txt` (zero errors/warnings). The tool browser independently exercised the missing-wallet control and observed its installation/reload recovery message. All inspected static requests were HTTP 200. No real wallet was connected and **no transaction was broadcast**.

## Better Interface consolidated review

Pinned guide attribution: Jakub Krehel / Better Interface, MIT, `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method Paul Bakaus / Impeccable, Apache-2.0, `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Source links and attribution are preserved in `web/README.md`.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/forms/details/dialog, persistent labels, disabled prerequisites, errors/status regions, skip link. Keyboard entry/Escape/focus return passed. Axe WCAG 2 A/AA and 2.1 AA scans reported zero violations in tested empty, connected and dialog states. Focus visible in screenshots; forced-colors link focus inspected. No screen-reader session or full accessibility certification. |
| Layout | Checked | 1440, 820, 390, 320px connected/empty layouts; no document horizontal overflow. Tool browser checked desktop, 820px and 320px live views. 200% CSS text enlargement passed; native browser zoom and physical devices unperformed. English-only product; RTL/localization variants not supplied. |
| Writing | Checked | Verb-first actions; token/network/spender consequences; quote limitations, rounding, unsold tokens and execution gas. Recoverable RPC/wallet/form errors. No unsupported sale-price guarantee. |
| Typography | Checked | Source hierarchy, selectable full identifiers, tabular numeric values, wrapping and bounded measures. Actual mobile inputs measured at least 16px. Font stack intentionally uses available system fallbacks; no claim that Inter is installed. |
| Colors | Checked | Rendered RGB foreground/background pairs measured: body 13.75:1, panel hints 5.76:1, disabled primary 5.02:1, header brand 14.47:1, pill 12.33:1, label 14.91:1. Specific pairs in rendered-checks.json; not an exhaustive contrast certificate. Only light theme is implemented. |
| UI details | Checked | Hover/disabled/pressed/empty/loading/error/review states, restrained button feedback, native modal background inertness, close/focus return, reduced-motion 0s transition. Forced-colors sample saved. No media, theme toggle or complex motion to inspect. |

Screenshots `desktop-connected.png`, `mobile-connected.png` and `approval-review-focus.png` use **mocked balances/orders** and are explicitly distinct from the live screenshots. They were opened and visually inspected. `forced-colors-focus.png` is the tool browser's live page with emulated forced colors. No screenshot or color ratio is synthetic evidence.

### Findings, corrections and rechecks

| Severity / domain | Final source location | Finding and fix | Recheck |
| --- | --- | --- | --- |
| High / functionality | `web/config/integrations.json:2`; `web/scripts/export.mjs:18` | Initial manual router transcription had an extra hex digit; viem rejected the address. Re-extracted the exact address from the pinned workflow and added build-time address validation. | Full swap tests and live code/manager reads passed. |
| Medium / writing | `web/src/App.tsx:367` | Missing state initially yielded “STOP approved”. Approval eligibility now defaults to required until the entered amount and allowance are known. | Disconnected screenshot and approval tests show accurate text. |
| Medium / accessibility | `web/src/App.tsx:255` | React autofocus in a persistently mounted closed dialog did not move focus to Go back when opened. Added explicit focus after showModal. Decorative step numbers were excluded from accessible names. | Keyboard entry, Escape and return passed; visible ring captured. |
| Medium / error writing | `web/src/config.ts:196` | viem short error messages hid the RPC revert detail. Append bounded details to the concise message. | Rejected wallet and InvalidTrigger simulation tested; no send. |
| High / observability | `web/src/App.tsx:122` | Source review found that a 30-second poll could restart a slow in-flight event scan. Guard the timer until the refresh finishes. | Production build/typecheck and event indexing tests passed; long-duration remote archive scans remain untested. |
| Medium / context | `web/src/App.tsx:539`; `web/src/styles.css:914` | Desktop testnet side note disappears on narrow layouts. Added Sepolia testnet to the always-visible intro label. | Final 320px connected/live screenshots show the network. |
| Medium / developer workflow | `web/vite.config.ts:7` | Source dev server initially lacked the generated runtime JSON. Dev now builds the handoff and serves the same dist manifest/ABIs through scoped middleware. | Development server smoke check passed. |

No unresolved observed primary-flow or layout defect remains. The root DESIGN.md location is intentionally remapped to comply with the stronger path restriction.

## Completion and limits

Complete for the stated frontend implementation and worker-side validation scope, with the design document at the permitted equivalent location. Tests and export checks are worker evidence only. Real approval/place/cancel/claim/execute/swap settlement, real wallet hardware/extensions, browser engines other than Chromium, screen-reader sessions, native zoom, deep reorganizations and prolonged provider outages were not performed. The read-only live quote does not prove swap settlement. PoolSwapTest cannot enforce an output floor or transaction deadline; its limits are exposed rather than hidden.

IPFS pinning, site naming, immutable/named HTTP checks and publication RPC verification are subsequent control-plane work. This submission does not claim those checks ran, publish a site, or redeploy contracts.

### Git metadata limitation

`git add -- web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. The environment explicitly mounts repository Git metadata read-only. All deliverable files remain in the workspace for collection; no workspace commit is claimed. A separate Git database under `/tmp/` is used only to validate the candidate tree and complete submission-delta bundle size, preserving the deployed parent history without modifying the protected `.git`.
