import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  decodeFunctionData,
  keccak256,
  parseAbiParameters,
  toHex,
  type Abi,
  type Hex,
} from "viem";
import type { Page } from "@playwright/test";
export const account = "0x1111111111111111111111111111111111111111";
export const other = "0x2222222222222222222222222222222222222222";
export const manifest = JSON.parse(
  readFileSync(resolve("../dist/imd-deployment.json"), "utf8"),
);
const getAbi = (p: string) =>
  JSON.parse(readFileSync(resolve("../dist", p), "utf8")) as Abi;
export const token = manifest.contracts.find((c: any) => c.name === "STOP");
export const hook = manifest.contracts.find(
  (c: any) => c.name === "StopLossHook",
);
const abis: Record<string, Abi> = {
  [token.address]: getAbi(token.abiPath),
  [hook.address]: getAbi(hook.abiPath),
  [manifest.integrations.poolSwapTest]: getAbi(
    manifest.integrations.abis.poolSwapTest,
  ),
  [manifest.network.uniswapV4.stateView]: getAbi(
    manifest.integrations.abis.stateView,
  ),
  [manifest.network.uniswapV4.quoter]: getAbi(
    manifest.integrations.abis.quoter,
  ),
};
const poolId = keccak256(
  encodeAbiParameters(
    parseAbiParameters("address,address,uint24,int24,address"),
    [
      manifest.pool.pairedCurrency,
      token.address,
      manifest.pool.fee,
      manifest.pool.tickSpacing,
      hook.address,
    ],
  ),
);
const ether = 10n ** 18n;
export async function mock(
  page: Page,
  opts: {
    connected?: boolean;
    wrongChain?: boolean;
    noWallet?: boolean;
    empty?: boolean;
    noCode?: boolean;
    rpcFailure?: boolean;
    logFailure?: boolean;
  } = {},
) {
  const f = {
    tick: 0,
    allowOrder: 0n,
    allowSwap: 0n,
    block: BigInt(manifest.deploymentBlock + 200),
    noCode: !!opts.noCode,
    rpcFailure: !!opts.rpcFailure,
    logFailure: !!opts.logFailure,
    failSim: false,
    revertReceipt: false,
    txCount: 0,
    calls: [] as {
      method: string;
      functionName?: string;
      args?: any;
      to?: string;
      value?: string;
    }[],
    orders: opts.empty
      ? []
      : [
          {
            id: 1n,
            owner: account,
            poolId,
            triggerTick: 600,
            amount: 10n * ether,
            epoch: 0n,
            cancelled: false,
            claimed: false,
          },
          {
            id: 2n,
            owner: account,
            poolId,
            triggerTick: 1200,
            amount: 20n * ether,
            epoch: 0n,
            cancelled: false,
            claimed: false,
          },
          {
            id: 3n,
            owner: account,
            poolId,
            triggerTick: 1800,
            amount: 5n * ether,
            epoch: 0n,
            cancelled: true,
            claimed: false,
          },
        ],
  };
  function epoch(tick: number) {
    return tick === 1200
      ? {
          amount: 20n * ether,
          ethOut: ether,
          unsold: 4n * ether,
          executed: true,
          claimedEth: 0n,
          claimedStop: 0n,
        }
      : {
          amount: 10n * ether,
          ethOut: 0n,
          unsold: 0n,
          executed: false,
          claimedEth: 0n,
          claimedStop: 0n,
        };
  }
  const placedBlocks = new Map(
    f.orders.map((o) => [o.id, BigInt(manifest.deploymentBlock + 10)]),
  );
  const hash = () => ("0x" + f.txCount.toString(16).padStart(64, "0")) as Hex;
  async function rpc(req: any): Promise<any> {
    const { method, params = [] } = req;
    if (f.rpcFailure) throw Error("Mock RPC is unavailable");
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_blockNumber") return toHex(f.block);
    if (method === "eth_getCode") return f.noCode ? "0x" : "0x6001600055";
    if (method === "eth_getBalance") return toHex(10n * ether);
    if (method === "eth_getLogs") {
      if (f.logFailure) throw Error("Mock log range unavailable");
      return f.orders
        .filter((o) => {
          const b = placedBlocks.get(o.id)!;
          return (
            b >= BigInt(params[0].fromBlock) && b <= BigInt(params[0].toBlock)
          );
        })
        .map((o, i) => ({
          address: hook.address,
          blockHash: "0x" + "a".repeat(64),
          blockNumber: toHex(placedBlocks.get(o.id)!),
          transactionHash: "0x" + "b".repeat(64),
          transactionIndex: "0x0",
          logIndex: toHex(i),
          removed: false,
          topics: encodeEventTopics({
            abi: abis[hook.address],
            eventName: "OrderPlaced",
            args: { orderId: o.id, owner: o.owner, poolId },
          }),
          data: encodeAbiParameters(
            parseAbiParameters("int24,uint128,uint256"),
            [o.triggerTick, o.amount, o.epoch],
          ),
        }));
    }
    if (method === "eth_call" || method === "eth_sendTransaction") {
      const tx = params[0];
      const address = tx.to.toLowerCase();
      const abi = abis[address];
      if (!abi) throw Error("Unexpected contract " + address);
      const decoded = decodeFunctionData({ abi, data: tx.data });
      const name = decoded.functionName;
      const args = (decoded.args as any[]) || [];
      f.calls.push({
        method,
        functionName: name,
        args,
        to: address,
        value: tx.value,
      });
      const stateCall = [
        "approve",
        "placeOrder",
        "cancel",
        "claim",
        "execute",
        "swap",
      ].includes(name);
      if (method === "eth_call" && stateCall && f.failSim)
        throw Error("Mock simulation reverted: InvalidTrigger");
      let result: any;
      switch (name) {
        case "poolManager":
        case "manager":
          result = manifest.network.uniswapV4.poolManager;
          break;
        case "getSlot0":
          result = [
            BigInt(Math.floor(2 ** 96 * Math.pow(1.0001, f.tick / 2))),
            f.tick,
            0,
            3000,
          ];
          break;
        case "getLiquidity":
          result = 1000000n * ether;
          break;
        case "decimals":
          result = 18;
          break;
        case "symbol":
          result = "STOP";
          break;
        case "totalSupply":
          result = 1000000000n * ether;
          break;
        case "balanceOf":
          result = 1000n * ether;
          break;
        case "allowance":
          result =
            args[1].toLowerCase() === hook.address ? f.allowOrder : f.allowSwap;
          break;
        case "openAmount":
          result = f.orders
            .filter(
              (o) =>
                o.triggerTick === args[1] &&
                !o.cancelled &&
                !epoch(o.triggerTick).executed,
            )
            .reduce((n, o) => n + o.amount, 0n);
          break;
        case "order": {
          const o = f.orders.find((o) => o.id === args[0]);
          result = o;
          break;
        }
        case "epoch":
          result = epoch(args[1]);
          break;
        case "quoteExactInputSingle":
          result = [args[0].exactAmount * 2n, 180000n];
          break;
        case "approve":
          result = true;
          if (method === "eth_sendTransaction") {
            if (args[0].toLowerCase() === hook.address) f.allowOrder = args[1];
            else f.allowSwap = args[1];
          }
          break;
        case "placeOrder":
          result = BigInt(f.orders.length + 1);
          if (method === "eth_sendTransaction")
            placedBlocks.set(result, f.block);
          if (method === "eth_sendTransaction")
            f.orders.push({
              id: result,
              owner: account,
              poolId,
              triggerTick: args[1],
              amount: args[2],
              epoch: 0n,
              cancelled: false,
              claimed: false,
            });
          break;
        case "cancel":
          if (method === "eth_sendTransaction")
            f.orders.find((o) => o.id === args[0])!.cancelled = true;
          break;
        case "claim":
          result = [ether, 4n * ether];
          if (method === "eth_sendTransaction")
            f.orders.find((o) => o.id === args[0])!.claimed = true;
          break;
        case "execute":
          result = 1n;
          break;
        case "swap": {
          const n = -args[1].amountSpecified;
          const out = n * 2n;
          result = args[1].zeroForOne
            ? (-n << 128n) | out
            : (out << 128n) | BigInt.asUintN(128, -n);
          break;
        }
        default:
          throw Error("Unhandled contract call " + name);
      }
      if (method === "eth_sendTransaction") {
        f.txCount++;
        f.block++;
        return hash();
      }
      return encodeFunctionResult({ abi, functionName: name, result });
    }
    if (method === "eth_getTransactionReceipt")
      return {
        transactionHash: hash(),
        transactionIndex: "0x0",
        blockHash: "0x" + "a".repeat(64),
        blockNumber: toHex(f.block),
        from: account,
        to: hook.address,
        cumulativeGasUsed: "0x186a0",
        gasUsed: "0x186a0",
        effectiveGasPrice: "0x1",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "0".repeat(512),
        status: f.revertReceipt ? "0x0" : "0x1",
        type: "0x2",
      };
    if (method === "eth_estimateGas") return "0x30000";
    throw Error("Unhandled RPC " + method);
  }
  await page.route("https://**", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.abort();
    const body = req.postDataJSON();
    let response;
    try {
      response = { jsonrpc: "2.0", id: body.id, result: await rpc(body) };
    } catch (e) {
      response = {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: (e as Error).message },
      };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  if (!opts.noWallet)
    await page.addInitScript(
      ({ account, connected, wrongChain }) => {
        const listeners: Record<string, Function[]> = {};
        const state = {
          accounts: connected ? [account] : [],
          chain: wrongChain ? "0x1" : "0xaa36a7",
          unknown: false,
          reject: false,
          calls: [] as any[],
        };
        (window as any).__wallet = state;
        const emit = (name: string, args: any) =>
          listeners[name]?.forEach((fn) => fn(args));
        (window as any).__emit = emit;
        (window as any).ethereum = {
          on: (e: string, fn: Function) => (listeners[e] ??= []).push(fn),
          removeListener: (e: string, fn: Function) =>
            (listeners[e] = listeners[e]?.filter((x) => x !== fn)),
          request: async (req: any) => {
            state.calls.push(req);
            if (
              state.reject &&
              ["eth_requestAccounts", "eth_sendTransaction"].includes(
                req.method,
              )
            ) {
              state.reject = false;
              throw { code: 4001, message: "User rejected request" };
            }
            if (req.method === "eth_accounts") return state.accounts;
            if (req.method === "eth_chainId") return state.chain;
            if (req.method === "eth_requestAccounts") {
              state.accounts = [account];
              emit("accountsChanged", state.accounts);
              return state.accounts;
            }
            if (req.method === "wallet_switchEthereumChain") {
              if (state.unknown) throw { code: 4902, message: "Unknown chain" };
              state.chain = req.params[0].chainId;
              emit("chainChanged", state.chain);
              return null;
            }
            if (req.method === "wallet_addEthereumChain") {
              state.unknown = false;
              return null;
            }
            const res = await fetch("https://mock.wallet.invalid", {
              method: "POST",
              body: JSON.stringify({ jsonrpc: "2.0", id: 42, ...req }),
              headers: { "Content-Type": "application/json" },
            });
            const json = await res.json();
            if (json.error) throw json.error;
            return json.result;
          },
        };
      },
      { account, connected: !!opts.connected, wrongChain: !!opts.wrongChain },
    );
  return f;
}
