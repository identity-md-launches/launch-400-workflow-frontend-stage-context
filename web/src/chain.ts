import {
  type Address,
  type Abi,
  type Hash,
  type AbiEvent,
  createWalletClient,
  custom,
  parseUnits,
  formatUnits,
} from "viem";
import { type Config, type Client, type Provider } from "./config";
export type Call = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};
export type Order = {
  id: bigint;
  owner: Address;
  poolId: Hash;
  triggerTick: number;
  amount: bigint;
  epoch: bigint;
  cancelled: boolean;
  claimed: boolean;
  settlement: Epoch;
};
export type Epoch = {
  amount: bigint;
  ethOut: bigint;
  unsold: bigint;
  executed: boolean;
  claimedEth: bigint;
  claimedStop: bigint;
};
export type Snapshot = {
  block: bigint;
  updatedAt: number;
  sqrt: bigint;
  tick: number;
  liquidity: bigint;
  decimals: number;
  symbol: string;
  balance: bigint;
  nativeBalance: bigint;
  orderAllowance: bigint;
  swapAllowance: bigint;
  totalSupply: bigint;
};
export const hookCall = (
  c: Config,
  functionName: string,
  args: readonly unknown[] = [],
): Call => ({ address: c.hook, abi: c.abis.StopLossHook, functionName, args });
export const tokenCall = (
  c: Config,
  functionName: string,
  args: readonly unknown[] = [],
): Call => ({ address: c.token, abi: c.abis.STOP, functionName, args });
export async function verifyDeployment(c: Config, p: Client) {
  if ((await p.getChainId()) !== c.d.chainId)
    throw Error("RPC is on the wrong chain. Transactions disabled.");
  const addresses = [
    ...c.d.contracts.map((x) => x.address),
    c.d.network.uniswapV4.poolManager,
    c.d.network.uniswapV4.stateView,
    c.d.network.uniswapV4.quoter,
    c.d.integrations.poolSwapTest,
  ];
  await Promise.all(
    addresses.map(async (address) => {
      const code = await p.getCode({ address });
      if (!code || code === "0x")
        throw Error(`No deployed code at ${address}. Transactions disabled.`);
    }),
  );
  const managers = await Promise.all([
    p.readContract(hookCall(c, "poolManager")),
    p.readContract({
      address: c.d.integrations.poolSwapTest,
      abi: c.abis.poolSwapTest,
      functionName: "manager",
    }),
    p.readContract({
      address: c.d.network.uniswapV4.stateView,
      abi: c.abis.stateView,
      functionName: "poolManager",
    }),
    p.readContract({
      address: c.d.network.uniswapV4.quoter,
      abi: c.abis.quoter,
      functionName: "poolManager",
    }),
  ]);
  if (
    managers.some(
      (m) =>
        String(m).toLowerCase() !==
        c.d.network.uniswapV4.poolManager.toLowerCase(),
    )
  )
    throw Error("PoolManager binding mismatch. Transactions disabled.");
}
export async function snapshot(
  c: Config,
  p: Client,
  account?: Address,
): Promise<Snapshot> {
  const block = await p.getBlockNumber({ cacheTime: 0 });
  const read = (call: Call) => p.readContract({ ...call, blockNumber: block });
  const [
    slot,
    liquidity,
    decimals,
    symbol,
    totalSupply,
    balance,
    nativeBalance,
    orderAllowance,
    swapAllowance,
  ] = await Promise.all([
    read({
      address: c.d.network.uniswapV4.stateView,
      abi: c.abis.stateView,
      functionName: "getSlot0",
      args: [c.poolId],
    }),
    read({
      address: c.d.network.uniswapV4.stateView,
      abi: c.abis.stateView,
      functionName: "getLiquidity",
      args: [c.poolId],
    }),
    read(tokenCall(c, "decimals")),
    read(tokenCall(c, "symbol")),
    read(tokenCall(c, "totalSupply")),
    account ? read(tokenCall(c, "balanceOf", [account])) : 0n,
    account ? p.getBalance({ address: account, blockNumber: block }) : 0n,
    account ? read(tokenCall(c, "allowance", [account, c.hook])) : 0n,
    account
      ? read(
          tokenCall(c, "allowance", [account, c.d.integrations.poolSwapTest]),
        )
      : 0n,
  ]);
  const [sqrt, tick] = slot as [bigint, number];
  if (sqrt === 0n)
    throw Error(
      "The pool is not initialized. Transactions disabled. Refresh after initialization.",
    );
  if (Number(decimals) !== 18 || symbol !== "STOP")
    throw Error("Token metadata does not match this STOP deployment.");
  return {
    block,
    updatedAt: Date.now(),
    sqrt,
    tick,
    liquidity: liquidity as bigint,
    decimals: Number(decimals),
    symbol: String(symbol),
    totalSupply: totalSupply as bigint,
    balance: balance as bigint,
    nativeBalance: nativeBalance as bigint,
    orderAllowance: orderAllowance as bigint,
    swapAllowance: swapAllowance as bigint,
  };
}
type Placement = {
  args: { orderId: bigint; owner: Address; poolId: Hash; triggerTick: number };
  blockNumber: bigint;
  logIndex: number;
};
// Session-only log index: overlap the last 12 blocks on each refresh to handle shallow reorgs.
export class EventIndex {
  private events: Placement[] = [];
  private through?: bigint;
  async scan(c: Config, p: Client, to: bigint, progress: (s: string) => void) {
    let from =
      this.through === undefined
        ? BigInt(c.d.deploymentBlock)
        : this.through - 12n;
    if (from < BigInt(c.d.deploymentBlock) || from > to)
      from = BigInt(c.d.deploymentBlock);
    const kept = this.events.filter((e) => e.blockNumber < from);
    const found: Placement[] = [];
    let span = 10000n;
    const event = c.abis.StopLossHook.find(
      (x) => x.type === "event" && x.name === "OrderPlaced",
    ) as AbiEvent;
    while (from <= to) {
      const end = from + span - 1n < to ? from + span - 1n : to;
      progress(
        `Reading order events ${from.toLocaleString()}–${end.toLocaleString()}…`,
      );
      try {
        const logs = await p.getLogs({
          address: c.hook,
          event,
          args: { poolId: c.poolId },
          fromBlock: from,
          toBlock: end,
          strict: true,
        });
        found.push(...(logs as unknown as Placement[]));
        from = end + 1n;
      } catch (e) {
        if (span <= 100n) throw e;
        span = span / 2n;
      }
    }
    this.events = [...kept, ...found];
    this.through = to;
    return this.events;
  }
}
async function mapLimited<T, U>(
  items: T[],
  fn: (x: T) => Promise<U>,
): Promise<U[]> {
  const output: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        output[i] = await fn(items[i]);
      }
    }),
  );
  return output;
}
export async function history(
  c: Config,
  p: Client,
  index: EventIndex,
  block: bigint,
  account: Address | undefined,
  progress: (s: string) => void,
  limit = 50,
) {
  const events = await index.scan(c, p, block, progress);
  const ticks = [...new Set(events.map((x) => x.args.triggerTick))].sort(
    (a, b) => a - b,
  );
  const mine = events
    .filter(
      (x) => account && x.args.owner.toLowerCase() === account.toLowerCase(),
    )
    .sort((a, b) => (a.args.orderId > b.args.orderId ? -1 : 1));
  progress(
    `Reading ${ticks.length} levels and ${Math.min(limit, mine.length)} orders…`,
  );
  const levels = await mapLimited(ticks, async (tick) => ({
    tick,
    amount: (await p.readContract({
      ...hookCall(c, "openAmount", [c.poolId, tick]),
      blockNumber: block,
    })) as bigint,
  }));
  const orders = await mapLimited(mine.slice(0, limit), async (log) => {
    const o = (await p.readContract({
      ...hookCall(c, "order", [log.args.orderId]),
      blockNumber: block,
    })) as Omit<Order, "id" | "settlement">;
    const settlement = (await p.readContract({
      ...hookCall(c, "epoch", [c.poolId, o.triggerTick, o.epoch]),
      blockNumber: block,
    })) as Epoch;
    return { ...o, id: log.args.orderId, settlement };
  });
  return {
    levels: levels.filter((l) => l.amount > 0n),
    orders,
    total: mine.length,
    block,
  };
}
export type History = Awaited<ReturnType<typeof history>>;
export function amountInput(
  value: string,
  decimals: number,
  min = 1n,
  max = (1n << 127n) - 1n,
) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value.trim()))
    throw Error(`Enter an amount with at most ${decimals} decimal places.`);
  const n = parseUnits(value.trim(), decimals);
  if (n < min) throw Error(`Enter at least ${formatUnits(min, decimals)}.`);
  if (n > max) throw Error("This amount exceeds the contract limit.");
  return n;
}
export function triggerInput(value: string, tick: number) {
  const n = Number(value);
  if (
    !/^-?\d+$/.test(value) ||
    !Number.isSafeInteger(n) ||
    n % 60 !== 0 ||
    n <= tick ||
    n < -887272 ||
    n > 886072
  )
    throw Error("Use a multiple of 60 above the current tick, at most 886020.");
  return n;
}
export const priceAtTick = (tick: number) => Math.pow(1.0001, -tick);
export const priceAtSqrt = (sqrt: bigint) => 1 / (Number(sqrt) / 2 ** 96) ** 2;
export function integerSqrt(n: bigint): bigint {
  if (n < 0n) throw Error("Negative square root");
  if (n < 2n) return n;
  let x = n;
  let y = (x + n / x) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
export function swapLimit(sqrt: bigint, buy: boolean, bps: number) {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500)
    throw Error("Use a price tolerance from 0.01% to 5%.");
  const result = integerSqrt(
    (sqrt * sqrt * 10000n) / BigInt(buy ? 10000 + bps : 10000 - bps),
  );
  if (
    result <= 4295128739n ||
    result >= 1461446703485210103287273052203988822378723970342n
  )
    throw Error("Price limit is outside the pool range.");
  return result;
}
export type Quote = {
  amount: bigint;
  out: bigint;
  gas: bigint;
  limit: bigint;
  buy: boolean;
  bps: number;
  at: number;
  block: bigint;
  account: Address;
};
export async function quoteSwap(
  c: Config,
  p: Client,
  s: Snapshot,
  account: Address,
  amount: bigint,
  buy: boolean,
  bps: number,
): Promise<Quote> {
  const limit = swapLimit(s.sqrt, buy, bps);
  const result = await p.simulateContract({
    address: c.d.network.uniswapV4.quoter,
    abi: c.abis.quoter,
    functionName: "quoteExactInputSingle",
    args: [
      { poolKey: c.key, zeroForOne: buy, exactAmount: amount, hookData: "0x" },
    ],
    account,
  });
  const [out, gas] = result.result as [bigint, bigint];
  if (out === 0n)
    throw Error(
      "The quote returns no output. Try a smaller amount or wait for liquidity.",
    );
  return {
    amount,
    out,
    gas,
    limit,
    buy,
    bps,
    at: Date.now(),
    block: s.block,
    account,
  };
}
export const swapCall = (c: Config, q: Quote): Call => ({
  address: c.d.integrations.poolSwapTest,
  abi: c.abis.poolSwapTest,
  functionName: "swap",
  args: [
    c.key,
    {
      zeroForOne: q.buy,
      amountSpecified: -q.amount,
      sqrtPriceLimitX96: q.limit,
    },
    { takeClaims: false, settleUsingBurn: false },
    "0x",
  ],
  value: q.buy ? q.amount : 0n,
});
export function deltas(packed: bigint, buy: boolean) {
  const a0 = BigInt.asIntN(128, packed >> 128n),
    a1 = BigInt.asIntN(128, packed);
  return { spent: -(buy ? a0 : a1), out: buy ? a1 : a0 };
}
export async function assertWallet(
  provider: Provider,
  c: Config,
  account: Address,
) {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(chain) !== c.d.chainId ||
    accounts[0]?.toLowerCase() !== account.toLowerCase()
  )
    throw Error(
      "Wallet account or network changed. Reconnect and review again.",
    );
}
export async function send(
  c: Config,
  p: Client,
  provider: Provider,
  account: Address,
  call: Call,
  status: (s: string, hash?: Hash) => void,
  validate?: (result: unknown) => void,
) {
  await assertWallet(provider, c, account);
  status("Checking transaction…");
  const sim = await p.simulateContract({ ...call, account });
  validate?.(sim.result);
  await assertWallet(provider, c, account);
  status("Confirm in your wallet…");
  const wallet = createWalletClient({
    chain: c.chain,
    transport: custom(provider),
  });
  const hash = await wallet.writeContract({
    ...sim.request,
    account,
    chain: c.chain,
  });
  status("Submitted. Waiting for confirmation…", hash);
  const receipt = await p.waitForTransactionReceipt({ hash, timeout: 120000 });
  if (receipt.status !== "success")
    throw Error(
      "Transaction reverted on chain. Inspect the transaction and refresh before trying again.",
    );
  status("Transaction confirmed.", hash);
  return hash;
}
export function displayAmount(n: bigint, decimals = 18) {
  const raw = formatUnits(n, decimals);
  const number = Number(raw);
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
export const displayPrice = (n: number) =>
  n.toLocaleString("en-US", { maximumSignificantDigits: 7 });
