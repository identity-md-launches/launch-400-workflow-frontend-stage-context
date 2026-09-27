import { test, expect } from "@playwright/test";
import {
  amountInput,
  triggerInput,
  swapLimit,
  priceAtSqrt,
  priceAtTick,
  EventIndex,
} from "../src/chain";
import type { Config, Client } from "../src/config";
import { readFileSync } from "node:fs";
test("base-unit precision, amount boundaries and signed tick orientation", () => {
  expect(amountInput("1.000000000000000001", 18)).toBe(1000000000000000001n);
  for (const value of ["1e3", "-1", "NaN", "0.0000000000000000001"])
    expect(() => amountInput(value, 18)).toThrow();
  expect(() => amountInput("0.999", 18, 10n ** 18n)).toThrow();
  expect(() => amountInput("170141183460469231732", 18)).toThrow();
  expect(triggerInput("-60", -61)).toBe(-60);
  expect(() => triggerInput("-60", -60)).toThrow();
  expect(() => triggerInput("886080", 0)).toThrow();
  expect(priceAtTick(60)).toBeLessThan(priceAtTick(0));
  expect(priceAtTick(-60)).toBeGreaterThan(priceAtTick(0));
});
test("sqrt price limits bound ETH per STOP in the correct direction", () => {
  const start = 2n ** 96n;
  const buy = swapLimit(start, true, 50),
    sell = swapLimit(start, false, 50);
  expect(priceAtSqrt(buy)).toBeCloseTo(1.005, 12);
  expect(priceAtSqrt(sell)).toBeCloseTo(0.995, 12);
  expect(buy).toBeLessThan(start);
  expect(sell).toBeGreaterThan(start);
  expect(() => swapLimit(start, true, 501)).toThrow();
  expect(() => swapLimit(start, false, 0)).toThrow();
});
test("event discovery reduces RPC ranges and replaces reorganized recent logs", async () => {
  const abi = JSON.parse(readFileSync("../dist/abi/StopLossHook.json", "utf8"));
  const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
  let reorg = false;
  const first = {
    blockNumber: 2n,
    logIndex: 0,
    args: {
      orderId: 1n,
      owner: "0x1111111111111111111111111111111111111111",
      poolId: "0x" + "0".repeat(64),
      triggerTick: 60,
    },
  };
  const second = {
    ...first,
    blockNumber: 15n,
    args: { ...first.args, orderId: 2n },
  };
  const client = {
    getLogs: async (p: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(p);
      if (p.toBlock - p.fromBlock > 100n) throw Error("range too wide");
      return (reorg ? [first] : [first, second]).filter(
        (l) => l.blockNumber >= p.fromBlock && l.blockNumber <= p.toBlock,
      );
    },
  } as unknown as Client;
  const c = {
    d: { deploymentBlock: 1 },
    abis: { StopLossHook: abi },
    hook: "0x1111111111111111111111111111111111111111",
    poolId: first.args.poolId,
  } as unknown as Config;
  const index = new EventIndex();
  const result = await index.scan(c, client, 201n, () => {});
  expect(result.length).toBe(2);
  expect(calls.length).toBeGreaterThan(2);
  // Use a separate near-tip index to test the 12-block overlap.
  const recent = new EventIndex();
  await recent.scan(c, client, 20n, () => {});
  reorg = true;
  const updated = await recent.scan(c, client, 21n, () => {});
  expect(updated.map((l) => l.args.orderId)).toEqual([1n]);
});
