# Stoploss frontend

One static React/TypeScript page for the attested STOP / native ETH pool on Sepolia. It supports injected browser wallets, exact STOP approvals, place/cancel/claim, permissionless execution of up to five eligible buckets, event-derived orders and open levels, and PoolSwapTest buys/sells. There is no backend, private credential, external font, analytics service, or runtime npm dependency.

## Install, develop, build, preview

Use Node 22.12+ (validated with Node 24.21.0 and npm 11.19.0). Run from the repository root:

```sh
npm ci --prefix web
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run verify:export
node web/scripts/serve.mjs
```

The last command serves the committed export at `http://localhost:4173/preview/`; stop it with Ctrl+C. `npm --prefix web run preview` also previews the export. Development: `npm --prefix web run dev` prepares a production manifest first, then serves source with hot reload. The Vite development middleware serves the same deployment JSON and ABI files from `dist/`. Use the production preview for final wallet validation.

Vite uses `base: './'`. The application has one page with anchor navigation. Serve all of `dist/`, retaining paths; no route rewrites or build step are needed at publication. Test the directory through HTTP(S), not `file://`. No publication or redeployment is performed by this worker.

## Configuration and provenance

The **only runtime deployment configuration** is `dist/imd-deployment.json`. `src/config.ts` fetches it relative to the entrypoint, loads its ABI paths, checks implementation ABI canonical Keccak hashes, creates the chain and pool key, and configures the public-RPC fallback transport. Addresses and ABIs are not imported into the application bundle as another map.

The build inputs live together in `web/config/`:

- `deployment-handoff.json`: preserved handoff for launch `69eb7948-b4ef-4d21-96b2-81500f63c7fb`, source `a866a595f27e6c610198ac45c135ec60b56f77e6`.
- `network.json`: supplied network and exact wallet-add-chain parameters. The network object is copied without changing any value into the export manifest.
- `integrations.json`: the approved workflow's PoolSwapTest address. This explicit assignment requirement takes precedence over the generic Universal Router example. Network-table addresses still supply PoolManager, StateView and V4Quoter. PoolSwapTest is absent from that table, so it is an additional manifest field, not a change to `network`.

`npm run build` first writes the Vite export and then runs `scripts/export.mjs`. The script retrieves `docs/abi/STOP.json` and `docs/abi/StopLossHook.json` with `git show` at the deployed source commit. Keep that commit available in the Git checkout. It validates the canonical, recursively key-sorted JSON Keccak hashes against the handoff and copies the raw pinned ABI bytes. It never regenerates contracts or changes deployed source. Minimal external integration ABI JSON is generated from the official interfaces referenced below.

The manifest contains the exact attested contract set, plus pool parameters, deployment block, wallet-add-chain parameters and external integration paths. The builder enumerates **every** export file other than the manifest and hashes final bytes with SHA-256. `verify:export` checks identity, complete inventory, ABI provenance, addresses, path safety, relative base, sizes and absence of tracked dependency caches. Never edit the export manually: rebuild and regenerate the manifest together.

No WalletConnect project ID was supplied. The application uses the injected EIP-1193 provider (`window.ethereum`); install a browser wallet or use its in-app browser. It requests a switch to the manifest chain. Error 4902 / unknown-chain errors trigger the exact `wallet_addEthereumChain` parameters and a second switch. Account and chain changes invalidate quotes and reviews. Public RPC reads fall back to the wallet provider only when connected to the correct chain. Signing always stays in the wallet.

## Order behavior

STOP has 18 decimals, checked on chain. Minimum order: 1 STOP. Trigger ticks must be multiples of 60 strictly above the current tick, with maximum 886020. A higher tick means **lower ETH per STOP**, so sells trigger stops; buys do not.

Approve the hook for the entered amount, wait for confirmation, then place the order as a separate transaction. Cancellation returns the escrow before execution. Claiming pays the order's proportional ETH and unsold STOP after execution; both shares round down and dust stays in the hook. Claims cannot be repeated. The hook has no fee or administrator and ignores hookData; this app sends empty hookData. Hook data is not authenticated identity.

OrderPlaced events are scanned from the deployment block, filtered by pool and then wallet owner. Discovery is incremental in memory, rescans the last 12 blocks, and reduces the RPC block span on range errors. It reads authoritative `order`, `epoch` and `openAmount` values at one block. The latest 50 wallet orders load first; “Load 50 older orders” expands this. Public levels include all discovered trigger ticks. Failed history is explicitly unavailable rather than treated as zero. Long scans hold their progress and are not restarted by the 30-second refresh timer. Reloading discards the session cache; deep reorganizations require a reload. Public providers must support logs from the deployment block.

Sells can execute up to five buckets; **the seller pays the extra execution gas**. “Execute up to 5 levels” is permissionless catch-up and charges the caller gas. Buckets beyond their trigger + 1200 price window are skipped and remain cancellable. Execution may be partial; claim returns any unsold STOP. The source-stage gas report remains in the original contract documentation; this worker did not rerun or alter the Solidity suite.

## Swap behavior and limits

Quotes use V4Quoter `quoteExactInputSingle` through `simulateContract` (`eth_call`, never a transaction). Buys use `zeroForOne=true`, negative `amountSpecified`, native ETH value and no token approval. Sells approve **PoolSwapTest directly**, independently of hook approval. Permit2 and Universal Router approvals are not used by this assigned router.

The user sets a 0.01–5% **price tolerance**. The app computes a directional `sqrtPriceLimitX96` with bigint integer square root, relative to the latest StateView price; the limit caps adverse ETH-per-STOP price movement. PoolSwapTest forwards this limit and empty hookData with `takeClaims=false` and `settleUsingBurn=false`.

PoolSwapTest has **no amountOutMinimum or deadline argument**. The interface explicitly does not promise a minimum received. Quotes expire in the UI after 60 seconds and invalidate on input/account/network changes. Before signing, the actual router call is simulated; a zero/partial fill or output below the quote less tolerance stops the request. The UI checks expiry again after simulation. These preflight checks cannot add on-chain guarantees: price can change before inclusion, a delayed transaction can still execute, and a partial fill can occur on chain. Unspent native input is refunded by the router; unspent STOP is not transferred. Quote gas is an estimate, not the final wallet transaction fee.

Every write gets a review dialog, wallet identity/chain checks, contract simulation, explicit signing, receipt status and explorer link. Missing code, wrong chain, ABI mismatch, stale data and unmet prerequisites disable writes. A submitted hash is retained if receipt tracking fails; inspect it and refresh before resubmitting.

## Validation

```sh
# Install a test browser once (or supply CHROMIUM_PATH to an existing Chromium).
cd web
npx playwright install chromium
npm test
```

Tests start a bounded static server automatically unless port 4173 already serves the export. They exercise the actual production bundle at `/preview/` using controlled RPC and wallet responses. They never broadcast real transactions. Test traces/failure artifacts go to `test/scratch/`; deliberate final screenshots and rendered-check measurements go to `docs/evidence/`. `test/scratch/` is not needed to build or test from a clean checkout.

See [validation](../docs/frontend-validation.md) for commands, 12 passing tests, observed live read-only checks, six-domain Better Interface review, fixes and limitations. See [design system](../docs/DESIGN.md) for implemented tokens and components. The root-level DESIGN.md request conflicts with the overriding path restriction; the complete document is delivered under `docs/`.

## Integration sources

Only ABI declarations, not the implementation of these external contracts, are included:

- [PoolSwapTest at the repository's v4-core revision](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/test/PoolSwapTest.sol): swap tuple, settings, return delta and native refund behavior.
- [IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol): exact-input quote tuple and result.
- [StateView](https://github.com/Uniswap/v4-periphery/blob/main/src/lens/StateView.sol): slot0, liquidity and immutable manager views. External interfaces consulted 2026-09-27; the delivered JSON declarations freeze the interface used by this build.

Design guidance attribution: Jakub Krehel, [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT, pinned `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus, [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0, pinned `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Applied from the supplied guide; no guide source was republished or relicensed.
