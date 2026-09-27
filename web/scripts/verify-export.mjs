import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, isAddress } from "viem";
import { canonical } from "./canonical.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(root, p));
const json = (p) => JSON.parse(read(p));
const handoff = json("web/config/deployment-handoff.json"),
  config = json("web/config/network.json"),
  m = json("dist/imd-deployment.json");
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(m[key], handoff[key], key);
assert.deepEqual(m.network, config.network);
assert.deepEqual(m.walletAddChain, config.walletAddChain);
assert.deepEqual(m.pool, handoff.manifest.pool);
assert.deepEqual(
  m.contracts.map(({ abiPath, ...c }) => c),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
assert.equal(
  m.integrations.poolSwapTest,
  json("web/config/integrations.json").poolSwapTest,
);
for (const address of [
  ...m.contracts.map((c) => c.address),
  ...Object.values(m.network.uniswapV4),
  m.integrations.poolSwapTest,
])
  assert.ok(isAddress(address), address);
for (const c of m.contracts) {
  const abi = json("dist/" + c.abiPath);
  assert.ok(Array.isArray(abi));
  assert.equal(
    keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2),
    c.abiHash,
  );
  assert.deepEqual(
    read("dist/" + c.abiPath),
    execFileSync("git", ["show", `${m.sourceCommit}:docs/abi/${c.name}.json`], {
      cwd: root,
    }),
  );
}
const paths = [];
let bytes = 0;
function walk(path = "") {
  for (const e of readdirSync(resolve(root, "dist", path), {
    withFileTypes: true,
  })) {
    const p = path + e.name;
    assert.ok(!e.isSymbolicLink(), "No symlinks");
    if (e.isDirectory()) walk(p + "/");
    else if (p !== "imd-deployment.json") paths.push(p);
  }
}
walk();
assert.deepEqual(paths.sort(), m.assets.map((a) => a.path).sort());
assert.equal(new Set(m.assets.map((a) => a.path)).size, m.assets.length);
assert.ok(m.assets.length <= 128);
for (const a of m.assets) {
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.ok(
    !a.path.startsWith("/") &&
      !a.path.split("/").includes("..") &&
      !a.path.includes(":"),
  );
  const b = read("dist/" + a.path);
  assert.ok(b.length <= 8388608);
  bytes += b.length;
  assert.equal(createHash("sha256").update(b).digest("hex"), a.sha256, a.path);
}
bytes += read("dist/imd-deployment.json").length;
assert.ok(bytes < 32 * 1024 * 1024);
assert.ok(json("web/package-lock.json").lockfileVersion >= 3);
assert.ok(read("dist/index.html").toString().includes("./assets/"));
const badFiles = execFileSync("git", ["ls-files", "--cached", "-z"], {
  cwd: root,
})
  .toString()
  .split("\0")
  .filter((p) =>
    /(^|\/)(node_modules|\.cache|\.npm|\.pnpm-store)(\/|$)|\.tgz$/.test(p),
  );
assert.deepEqual(badFiles, []);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      sourceCommit: m.sourceCommit,
      contracts: m.contracts.length,
      assets: m.assets.length,
      exportBytes: bytes,
      checks: [
        "exact handoff identity",
        "unchanged network and walletAddChain",
        "valid centralized addresses",
        "pinned raw ABIs and canonical Keccak",
        "complete SHA-256 inventory",
        "relative asset base",
        "limits and no tracked caches",
      ],
    },
    null,
    2,
  ),
);
