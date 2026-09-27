import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  custom,
  keccak256,
  toHex,
  encodeAbiParameters,
  parseAbiParameters,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
export interface Provider extends Pick<EIP1193Provider, "request"> {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
}
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export interface Deployment {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: {
    fee: number;
    tickSpacing: number;
    initialPrice: string;
    pairedCurrency: Address;
  };
  deploymentBlock: number;
  integrations: {
    poolSwapTest: Address;
    abis: Record<"poolSwapTest" | "stateView" | "quoter", string>;
  };
  assets: { path: string; sha256: string }[];
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
export const poolTuple = parseAbiParameters(
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
);
export async function loadConfig() {
  const base = new URL("./", window.location.href);
  const fetchJson = async (path: string) => {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(path) ||
      path.startsWith("/") ||
      path.split("/").includes("..")
    )
      throw Error("Unsafe configuration path");
    const res = await fetch(new URL(path, base), { cache: "no-store" });
    if (!res.ok)
      throw Error(`Cannot load ${path} (${res.status}). Reload to retry.`);
    return res.json();
  };
  const d = (await fetchJson("imd-deployment.json")) as Deployment;
  if (
    d.version !== 1 ||
    d.chainId !== d.network.chainId ||
    BigInt(d.walletAddChain.chainId) !== BigInt(d.chainId)
  )
    throw Error("Deployment network mismatch. Transactions disabled.");
  const abis: Record<string, Abi> = {};
  for (const c of d.contracts) {
    const abi = await fetchJson(c.abiPath);
    if (
      !Array.isArray(abi) ||
      keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2) !== c.abiHash
    )
      throw Error(`${c.name} ABI verification failed. Transactions disabled.`);
    abis[c.name] = abi;
  }
  for (const [name, path] of Object.entries(d.integrations.abis))
    abis[name] = await fetchJson(path);
  const token = d.contracts.find((c) => c.name === "STOP");
  const hook = d.contracts.find((c) => c.name === "StopLossHook");
  if (
    !token ||
    !hook ||
    d.pool.pairedCurrency !== "0x0000000000000000000000000000000000000000"
  )
    throw Error("Unsupported deployment pool.");
  const key = {
    currency0: d.pool.pairedCurrency as Address,
    currency1: token.address,
    fee: d.pool.fee,
    tickSpacing: d.pool.tickSpacing,
    hooks: hook.address,
  };
  const poolId = keccak256(encodeAbiParameters(poolTuple, [key]));
  const chain = defineChain({
    id: d.chainId,
    name: d.network.name,
    nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: d.network.explorer } },
    testnet: d.network.testnet,
  });
  return {
    d,
    abis,
    token: token.address,
    hook: hook.address,
    key,
    poolId,
    chain,
  };
}
export type Config = Awaited<ReturnType<typeof loadConfig>>;
export function readClient(c: Config, provider?: Provider) {
  return createPublicClient({
    chain: c.chain,
    transport: fallback(
      [
        ...c.d.network.rpcUrls.map((url) =>
          http(url, { timeout: 8000, retryCount: 0 }),
        ),
        ...(provider ? [custom(provider, { retryCount: 0 })] : []),
      ],
      { retryCount: 0 },
    ),
  });
}
export type Client = ReturnType<typeof readClient>;
export async function switchNetwork(p: Provider, c: Config) {
  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: c.d.walletAddChain.chainId }],
    });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (
      err.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(err.message ?? "")
    )
      throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [c.d.walletAddChain],
    });
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: c.d.walletAddChain.chainId }],
    });
  }
}
export function errorText(e: unknown) {
  const err = e as {
    shortMessage?: string;
    message?: string;
    code?: number;
    details?: string;
  };
  if (
    err.code === 4001 ||
    /rejected|denied/i.test(err.shortMessage ?? err.message ?? "")
  )
    return "Request declined in your wallet. Nothing else was submitted. You can try again.";
  const summary =
    err.shortMessage ??
    err.message ??
    "Unable to complete this request. Check your connection and try again.";
  return `${summary}${err.details && !summary.includes(err.details) ? ` ${err.details}` : ""}`.slice(
    0,
    700,
  );
}
