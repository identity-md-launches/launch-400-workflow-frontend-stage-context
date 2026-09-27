import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, parseAbi, isAddress } from "viem";
import { canonical } from "./canonical.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const handoff = json("web/config/deployment-handoff.json");
const { network, walletAddChain } = json("web/config/network.json");
const integration = json("web/config/integrations.json");
for (const address of [
  integration.poolSwapTest,
  ...handoff.contracts.map((c) => c.address),
  ...Object.values(network.uniswapV4),
]) {
  if (!isAddress(address))
    throw Error(`Invalid deployment address: ${address}`);
}
if (
  handoff.chainId !== network.chainId ||
  BigInt(walletAddChain.chainId) !== BigInt(handoff.chainId)
)
  throw Error("Network chain mismatch");
const out = resolve(root, "dist");
mkdirSync(resolve(out, "abi"), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash }) => {
  const bytes = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${name}.json`],
    { cwd: root },
  );
  const abi = JSON.parse(bytes);
  if (
    !Array.isArray(abi) ||
    keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2) !== abiHash
  )
    throw Error(`${name} ABI hash mismatch`);
  const abiPath = `abi/${name}.json`;
  writeFileSync(resolve(out, abiPath), bytes);
  return { name, address, abiHash, abiPath };
});
const pool =
  "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
const externalAbis = {
  PoolSwapTest: parseAbi([
    `function swap(${pool} key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, (bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) payable returns (int256 delta)`,
    "function manager() view returns (address)",
    "error NoSwapOccurred()",
  ]),
  StateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
    "function poolManager() view returns (address)",
  ]),
  V4Quoter: parseAbi([
    `function quoteExactInputSingle((${pool} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
    "function poolManager() view returns (address)",
  ]),
};
for (const [name, abi] of Object.entries(externalAbis))
  writeFileSync(
    resolve(out, `abi/${name}.json`),
    JSON.stringify(abi, null, 2) + "\n",
  );
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  network,
  walletAddChain,
  pool: handoff.manifest.pool,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
  integrations: {
    poolSwapTest: integration.poolSwapTest,
    abis: {
      poolSwapTest: "abi/PoolSwapTest.json",
      stateView: "abi/StateView.json",
      quoter: "abi/V4Quoter.json",
    },
  },
  assets: [],
};
function walk(dir, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) walk(resolve(dir, entry.name), path + "/");
    else if (path !== "imd-deployment.json") {
      if (!entry.isFile()) throw Error("Non-file asset");
      const bytes = readFileSync(resolve(dir, entry.name));
      if (bytes.length > 8388608) throw Error("Asset too large");
      manifest.assets.push({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
walk(out);
manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
if (manifest.assets.length > 128) throw Error("Too many assets");
writeFileSync(
  resolve(out, "imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Bound ${contracts.length} implementation ABIs from ${handoff.sourceCommit}; inventoried ${manifest.assets.length} assets.`,
);
console.log(
  `Export: ${manifest.assets.reduce((n, a) => n + statSync(resolve(out, a.path)).size, statSync(resolve(out, "imd-deployment.json")).size)} bytes.`,
);
