import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mock, account, other, manifest, hook, token } from "./fixture";
async function loaded(page: Page) {
  await page.goto("./");
  await expect(page.getByText(/Pool connected/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "My orders" })).toBeVisible();
}
async function confirm(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".transaction-status")).toContainText(
    "Transaction confirmed.",
  );
}
test("static subpath, disconnected wallet, missing wallet, empty state and accessibility", async ({
  page,
}) => {
  await mock(page, { noWallet: true, empty: true });
  await loaded(page);
  await expect(
    page.getByRole("button", { name: "Place order", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("No open levels yet")).toBeVisible();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No browser wallet found" }),
  ).toBeVisible();
  await page.addScriptTag({
    content: readFileSync("node_modules/axe-core/axe.min.js", "utf8"),
  });
  const violations = await page.evaluate(
    async () =>
      (
        await (window as any).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations,
  );
  expect(violations).toEqual([]);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("unknown chain prompts add-chain with exact handoff parameters; account changes clear orders", async ({
  page,
}) => {
  await mock(page, { connected: true, wrongChain: true });
  await loaded(page);
  await expect(
    page.getByRole("button", { name: "Place order", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).__wallet.unknown = true;
  });
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(
    page.getByRole("button", { name: "Approve STOP", exact: true }),
  ).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__wallet.calls);
  expect(
    calls
      .filter((c: any) => c.method.startsWith("wallet_"))
      .map((c: any) => c.method),
  ).toEqual([
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
  expect(
    calls.find((c: any) => c.method === "wallet_addEthereumChain").params[0],
  ).toEqual(manifest.walletAddChain);
  await page.evaluate((other) => {
    (window as any).__wallet.accounts = [other];
    (window as any).__emit("accountsChanged", [other]);
  }, other);
  await expect(page.getByText("No orders for this wallet")).toBeVisible();
});
test("minimum amount and tick validation; exact approval, placement, cancel, claim, execute", async ({
  page,
}) => {
  const f = await mock(page, { connected: true });
  await loaded(page);
  await expect(page.getByText("Order #1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve STOP", exact: true }).click();
  await expect(page.locator("#order-amount")).toBeFocused();
  await expect(page.locator("#order-error")).toContainText("Enter an amount");
  await page.getByLabel("Amount to escrow").fill("0.5");
  await page.getByRole("button", { name: "Approve STOP", exact: true }).click();
  await expect(page.locator("#order-error")).toContainText("at least 1");
  await page.getByLabel("Amount to escrow").fill("12");
  await page.getByLabel("Trigger tick", { exact: true }).fill("59");
  await page.getByRole("button", { name: "Approve STOP", exact: true }).click();
  await expect(page.locator("#order-error")).toContainText("multiple of 60");
  await page.getByLabel("Trigger tick", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Approve STOP", exact: true }).click();
  await confirm(page);
  expect(f.allowOrder).toBe(12n * 10n ** 18n);
  await expect(
    page.getByRole("button", { name: "Place order", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await confirm(page);
  await expect(page.getByText("Order #4", { exact: true })).toBeVisible();
  await page
    .locator(".order-row")
    .filter({ hasText: "Order #1" })
    .getByRole("button", { name: "Cancel order" })
    .click();
  await confirm(page);
  await expect(
    page.locator(".order-row").filter({ hasText: "Order #1" }),
  ).toContainText("Cancelled");
  await page
    .locator(".order-row")
    .filter({ hasText: "Order #2" })
    .getByRole("button", { name: "Claim proceeds" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "1 ETH and 4 unsold STOP",
  );
  await confirm(page);
  await expect(
    page.locator(".order-row").filter({ hasText: "Order #2" }),
  ).toContainText("Claimed");
  f.tick = 660;
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    page.getByRole("button", { name: "Execute up to 5 levels" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Execute up to 5 levels" }).click();
  await confirm(page);
  expect(
    f.calls
      .filter((c) => c.method === "eth_sendTransaction")
      .map((c) => c.functionName),
  ).toEqual(["approve", "placeOrder", "cancel", "claim", "execute"]);
  const approve = f.calls.find(
    (c) => c.method === "eth_sendTransaction" && c.functionName === "approve",
  )!;
  expect(approve.to).toBe(token.address);
  expect(approve.args[0].toLowerCase()).toBe(hook.address);
});
test("native buy has no approval; token sell approves only PoolSwapTest and sends negative exact input", async ({
  page,
}) => {
  const f = await mock(page, { connected: true });
  await loaded(page);
  await page.getByLabel("You pay").fill("0.01");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review swap" })).toBeVisible();
  await page.getByRole("button", { name: "Review swap" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "no output guarantee or deadline",
  );
  await confirm(page);
  let sent = f.calls.filter((c) => c.method === "eth_sendTransaction");
  expect(sent.map((c) => c.functionName)).toEqual(["swap"]);
  expect(BigInt(sent[0].value!)).toBe(10n ** 16n);
  expect(sent[0].to).toBe(manifest.integrations.poolSwapTest);
  expect(sent[0].args[1].zeroForOne).toBe(true);
  expect(sent[0].args[1].amountSpecified).toBe(-(10n ** 16n));
  expect(sent[0].args[1].sqrtPriceLimitX96).toBeLessThan(2n ** 96n);
  await page.getByRole("button", { name: "Sell STOP", exact: true }).click();
  await page.getByLabel("You pay").fill("2");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve STOP for swap", exact: true })
    .click();
  await confirm(page);
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page.getByRole("button", { name: "Review swap" }).click();
  await confirm(page);
  sent = f.calls.filter((c) => c.method === "eth_sendTransaction");
  expect(sent.map((c) => c.functionName)).toEqual(["swap", "approve", "swap"]);
  expect(sent[1].args[0].toLowerCase()).toBe(
    manifest.integrations.poolSwapTest,
  );
  expect(sent[1].args[1]).toBe(2n * 10n ** 18n);
  expect(sent[2].args[1].zeroForOne).toBe(false);
  expect(sent[2].args[1].sqrtPriceLimitX96).toBeGreaterThan(2n ** 96n);
  expect(BigInt(sent[2].value ?? "0")).toBe(0n);
  expect(
    f.calls.some(
      (c) =>
        c.functionName === "quoteExactInputSingle" &&
        c.to === manifest.network.uniswapV4.quoter &&
        c.method === "eth_call",
    ),
  ).toBe(true);
});
test("wallet rejection, simulation failure, price validation and quote invalidation", async ({
  page,
}) => {
  const f = await mock(page, { connected: true });
  await loaded(page);
  await page.getByLabel("Amount to escrow").fill("10");
  await page.getByLabel("Trigger tick", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Approve STOP", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__wallet.reject = true;
  });
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Request declined");
  expect(f.txCount).toBe(0);
  f.failSim = true;
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("InvalidTrigger");
  expect(f.txCount).toBe(0);
  await page.getByRole("button", { name: "Go back" }).click();
  f.failSim = false;
  await page.getByLabel("You pay").fill("0.01");
  await page.getByLabel("Price tolerance", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(page.locator("#swap-error")).toContainText("0.01% to 5%");
  await page.getByLabel("Price tolerance", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review swap" })).toBeVisible();
  await page.getByLabel("You pay").fill("0.02");
  await expect(page.getByRole("button", { name: "Review swap" })).toHaveCount(
    0,
  );
});
test("absent deployed code and failed events disable dependent actions without showing false zero totals", async ({
  page,
}) => {
  const f = await mock(page, { connected: true, noCode: true });
  await page.goto("./");
  await expect(
    page.getByRole("alert").filter({ hasText: "No deployed code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve STOP", exact: true }),
  ).toBeDisabled();
  f.noCode = false;
  f.logFailure = true;
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    page.getByText("Order history could not be loaded.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execute up to 5 levels" }),
  ).toBeDisabled();
  await expect(page.getByText("No open levels yet")).toHaveCount(0);
});
test("tampered implementation ABI stops boot before any transaction control", async ({
  page,
}) => {
  await mock(page, { connected: true });
  await page.route("**/abi/STOP.json", (r) =>
    r.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Unable to verify deployment" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "ABI verification failed",
  );
  await expect(
    page.getByRole("button", { name: "Place order", exact: true }),
  ).toHaveCount(0);
});
test("keyboard dialog focus and 200% text enlargement", async ({ page }) => {
  await mock(page, { connected: true });
  await loaded(page);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.getByLabel("Amount to escrow").fill("10");
  await page.getByLabel("Trigger tick", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Approve STOP", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Go back" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Approve STOP", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.addStyleTag({ content: "html{font-size:200%}" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("connected desktop/mobile screenshots, rendered contrast and dialog accessibility", async ({
  page,
}) => {
  const { writeFileSync } = await import("node:fs");
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => failures.push(r.url()));
  await mock(page, { connected: true });
  await loaded(page);
  await expect(page.getByText("Order #2", { exact: true })).toBeVisible();
  await page.getByLabel("Amount to escrow").fill("12");
  await page.getByLabel("Trigger tick", { exact: true }).fill("600");
  await page.addScriptTag({
    content: readFileSync("node_modules/axe-core/axe.min.js", "utf8"),
  });
  const audit = async () =>
    page.evaluate(async () =>
      (
        await (window as any).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
      })),
    );
  expect(await audit()).toEqual([]);
  const widths = [];
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const measures = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    widths.push(measures);
    expect(measures.scrollWidth).toBeLessThanOrEqual(width);
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: `../docs/evidence/${width === 1440 ? "desktop" : "mobile"}-connected.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const colors = await page.evaluate(() => {
    const bg = (e: Element | null): string => {
      if (!e) return "rgb(255, 255, 255)";
      const s = getComputedStyle(e).backgroundColor;
      return s === "rgba(0, 0, 0, 0)" ? bg(e.parentElement) : s;
    };
    return [
      "body",
      ".panel .hint",
      ".primary",
      ".site-header .brand",
      ".pill",
      ".field-heading label",
    ].map((selector) => {
      const e = document.querySelector(selector)!;
      return {
        selector,
        foreground: getComputedStyle(e).color,
        background: bg(e),
      };
    });
  });
  const l = (rgb: string) => {
    const a = rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const pairs = colors.map((x) => ({
    ...x,
    contrast: Number(
      (
        (Math.max(l(x.foreground), l(x.background)) + 0.05) /
        (Math.min(l(x.foreground), l(x.background)) + 0.05)
      ).toFixed(2),
    ),
  }));
  pairs.forEach((x) => expect(x.contrast).toBeGreaterThanOrEqual(4.5));
  await page.getByRole("button", { name: "Approve STOP", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Go back" })).toBeFocused();
  expect(await audit()).toEqual([]);
  await page.screenshot({ path: "../docs/evidence/approval-review-focus.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "Go back" })
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  writeFileSync(
    "../docs/evidence/rendered-checks.json",
    JSON.stringify(
      {
        environment: "Chromium desktop; wallet and RPC mocked",
        widths,
        axeViolations: [],
        consoleErrors: errors,
        failedRequests: failures,
        renderedColors: pairs,
        reducedMotion: "transitionDuration 0s",
        keyboard: "Dialog entry, Escape exit and focus restoration tested",
        nativeZoom:
          "Not performed; 200% CSS text enlargement tested separately",
      },
      null,
      2,
    ) + "\n",
  );
});
