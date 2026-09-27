import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatUnits, type Address, type Hash } from "viem";
import {
  loadConfig,
  readClient,
  switchNetwork,
  errorText,
  type Config,
} from "./config";
import {
  EventIndex,
  snapshot,
  verifyDeployment,
  history,
  amountInput,
  triggerInput,
  priceAtTick,
  priceAtSqrt,
  displayAmount,
  displayPrice,
  hookCall,
  tokenCall,
  quoteSwap,
  swapCall,
  deltas,
  send,
  type Snapshot,
  type History,
  type Quote,
  type Call,
  type Order,
} from "./chain";
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function AddressLink({
  c,
  address,
  label,
}: {
  c: Config;
  address: string;
  label: string;
}) {
  return (
    <a
      href={`${c.d.network.explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {label} <Arrow />
    </a>
  );
}
export default function App() {
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState("");
  useEffect(() => {
    loadConfig()
      .then(setConfig)
      .catch((e) => setError(errorText(e)));
  }, []);
  if (!config)
    return (
      <main className="boot">
        <div className="brand">
          Stoploss<span className="brand-dot">.</span>
        </div>
        <h1>
          {error ? "Unable to verify deployment" : "Opening the order desk…"}
        </h1>
        <p role={error ? "alert" : "status"}>
          {error ||
            "Loading the deployment manifest and checking contract ABIs."}
        </p>
        {error && (
          <button onClick={() => location.reload()}>Reload deployment</button>
        )}
      </main>
    );
  return <Desk c={config} />;
}
type Review = {
  title: string;
  description: string;
  call: Call;
  quote?: Quote;
  execute?: boolean;
};
function Desk({ c }: { c: Config }) {
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState(50);
  const [state, setState] = useState<Snapshot>();
  const [verified, setVerified] = useState(false);
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [eventStatus, setEventStatus] = useState("");
  const [eventError, setEventError] = useState("");
  const [hist, setHist] = useState<History>();
  const [amount, setAmount] = useState("");
  const [trigger, setTrigger] = useState("");
  const [orderError, setOrderError] = useState("");
  const [orderInvalid, setOrderInvalid] = useState("");
  const [buy, setBuy] = useState(true);
  const [swapAmount, setSwapAmount] = useState("");
  const [tolerance, setTolerance] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [quoting, setQuoting] = useState(false);
  const [swapError, setSwapError] = useState("");
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [txError, setTxError] = useState("");
  const [txHash, setTxHash] = useState<Hash>();
  const [now, setNow] = useState(Date.now());
  const syncing = useRef(false);
  const index = useRef(new EventIndex());
  const dialog = useRef<HTMLDialogElement>(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const client = useMemo(
    () =>
      readClient(
        c,
        account && walletChain === c.d.chainId ? window.ethereum : undefined,
      ),
    [c, account, walletChain],
  );
  const wrongChain = !!account && walletChain !== c.d.chainId;
  const fresh = !!state && now - state.updatedAt < 60000;
  const ready =
    !!account &&
    !wrongChain &&
    verified &&
    fresh &&
    !readError &&
    !loading &&
    !busy &&
    !quoting;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      if (!busy && !quoting && !syncing.current) setRevision((n) => n + 1);
    }, 30000);
    return () => clearInterval(t);
  }, [busy, quoting]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const changed = (...args: unknown[]) => {
      setAccount((args[0] as Address[])[0]);
      setState(undefined);
      setHist(undefined);
      setVerified(false);
      setQuote(undefined);
      setReview(undefined);
    };
    const chainChanged = (...args: unknown[]) => {
      setWalletChain(Number(args[0]));
      setQuote(undefined);
      setReview(undefined);
      setVerified(false);
      setRevision((n) => n + 1);
    };
    const disconnected = () => {
      setAccount(undefined);
      setHist(undefined);
      setState(undefined);
      setQuote(undefined);
      setReview(undefined);
    };
    Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ])
      .then(([accounts, chain]) => {
        setAccount(accounts[0]);
        setWalletChain(Number(chain));
      })
      .catch(() => {});
    provider.on?.("accountsChanged", changed);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", changed);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    syncing.current = true;
    setLoading(true);
    setReadError("");
    setEventError("");
    setVerified(false);
    (async () => {
      try {
        await verifyDeployment(c, client);
        const current = await snapshot(c, client, account);
        if (cancelled) return;
        setVerified(true);
        setState(current);
        setNow(Date.now());
        setLoading(false);
        setEventStatus("Loading order events…");
        try {
          const data = await history(
            c,
            client,
            index.current,
            current.block,
            account,
            (s) => {
              if (!cancelled) setEventStatus(s);
            },
            limit,
          );
          if (!cancelled) {
            setHist(data);
            setEventStatus("");
          }
        } catch (e) {
          if (!cancelled) {
            setEventError(errorText(e));
            setEventStatus("");
            setHist(undefined);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setReadError(errorText(e));
          setVerified(false);
          setLoading(false);
          setHist(undefined);
          setEventStatus("");
        }
      } finally {
        if (!cancelled) syncing.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [c, client, account, revision, limit]);
  useEffect(() => {
    if (review) {
      dialog.current?.showModal();
      dialog.current
        ?.querySelector<HTMLButtonElement>("[data-dialog-back]")
        ?.focus();
    } else {
      dialog.current?.close();
    }
  }, [review]);
  async function connect() {
    setWalletError("");
    if (!window.ethereum) {
      setWalletError(
        "No browser wallet found. Install an Ethereum wallet or open this page in its browser, then reload.",
      );
      return;
    }
    setWalletBusy(true);
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(accounts[0]);
      setWalletChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
    } catch (e) {
      setWalletError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  }
  async function switchChain() {
    if (!window.ethereum) return;
    setWalletBusy(true);
    setWalletError("");
    try {
      await switchNetwork(window.ethereum, c);
      setWalletChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setWalletError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  }
  function openReview(r: Review) {
    if (!ready) return;
    setTxError("");
    setTxStatus("");
    setTxHash(undefined);
    setReview(r);
  }
  async function confirm() {
    if (!review || !account || !window.ethereum || !ready) return;
    const r = review;
    setBusy(true);
    setTxError("");
    try {
      if (
        r.quote &&
        (Date.now() - r.quote.at > 60000 || r.quote.account !== account)
      )
        throw Error(
          "Quote expired or account changed. Close this review and get a new quote.",
        );
      await send(
        c,
        client,
        window.ethereum,
        account,
        r.call,
        (message, hash) => {
          setTxStatus(message);
          if (hash) setTxHash(hash);
        },
        (result) => {
          if (r.quote) {
            if (Date.now() - r.quote.at > 60000)
              throw Error(
                "Quote expired during simulation. Close this review and get a new quote.",
              );
            const d = deltas(result as bigint, r.quote.buy);
            if (d.out <= 0n || d.spent <= 0n)
              throw Error("Simulation returned no swap. Get a new quote.");
            if (d.spent !== r.quote.amount)
              throw Error(
                "The price limit would only fill part of this swap. Close this review and use a smaller amount.",
              );
            if (d.out < (r.quote.out * BigInt(10000 - r.quote.bps)) / 10000n)
              throw Error(
                "Simulated output moved beyond your tolerance. Close this review and get a new quote.",
              );
          }
          if (r.execute && result === 0n)
            throw Error(
              "No eligible buckets executed in simulation. Refresh the levels before trying again.",
            );
        },
      );
      setReview(undefined);
      setQuote(undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      setTxError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const approveNeeded = (() => {
    try {
      return (
        !state || amountInput(amount, state.decimals) > state.orderAllowance
      );
    } catch {
      return true;
    }
  })();
  function submitOrder(e: FormEvent, approve = false) {
    e.preventDefault();
    if (!ready || !state) return;
    setOrderError("");
    setOrderInvalid("");
    let field = "order-amount";
    try {
      const n = amountInput(
        amount,
        state.decimals,
        10n ** BigInt(state.decimals),
      );
      if (n > state.balance)
        throw Error(
          "Amount exceeds your STOP balance. Buy STOP or enter a smaller amount.",
        );
      field = "trigger";
      const tick = triggerInput(trigger, state.tick);
      if (approve) {
        openReview({
          title: "Approve STOP for orders",
          description: `Allow StopLossHook to spend exactly ${formatUnits(n, state.decimals)} STOP. Placing the order is a separate transaction.`,
          call: tokenCall(c, "approve", [c.hook, n]),
        });
      } else {
        if (state.orderAllowance < n)
          throw Error("Approve this amount of STOP first.");
        openReview({
          title: "Place stop-loss order",
          description: `Escrow ${formatUnits(n, state.decimals)} STOP at tick ${tick} (about ${displayPrice(priceAtTick(tick))} ETH per STOP). You can cancel until its epoch executes.`,
          call: hookCall(c, "placeOrder", [c.key, tick, n]),
        });
      }
    } catch (e) {
      setOrderError(errorText(e));
      setOrderInvalid(field);
      document.getElementById(field)?.focus();
    }
  }
  async function getQuote(e: FormEvent) {
    e.preventDefault();
    if (!ready || !state || !account) return;
    setSwapError("");
    setQuote(undefined);
    setQuoting(true);
    const who = account;
    try {
      const n = amountInput(
        swapAmount,
        buy ? c.d.network.nativeCurrency.decimals : state.decimals,
      );
      if (n > (buy ? state.nativeBalance : state.balance))
        throw Error(`Amount exceeds your ${buy ? "ETH" : "STOP"} balance.`);
      if (!/^\d+(\.\d{1,2})?$/.test(tolerance))
        throw Error(
          "Use a price tolerance from 0.01% to 5%, with at most two decimals.",
        );
      const freshState = await snapshot(c, client, account);
      const q = await quoteSwap(
        c,
        client,
        freshState,
        account,
        n,
        buy,
        Math.round(Number(tolerance) * 100),
      );
      if (accountRef.current !== who) return;
      setQuote(q);
    } catch (e) {
      setSwapError(errorText(e));
    } finally {
      setQuoting(false);
    }
  }
  const quoteFresh = !!quote && now - quote.at < 60000;
  const blocked = !account
    ? "Connect your wallet to place orders and swap."
    : wrongChain
      ? `Switch to ${c.d.network.name} to enable transactions.`
      : readError
        ? "Live verification failed. Refresh to try again."
        : loading
          ? "Checking deployed contracts and reading the pool…"
          : !fresh
            ? "Pool data is stale. Refresh before continuing."
            : !verified
              ? "Deployment verification is required."
              : "Transactions are simulated before your wallet opens.";
  const openTotal = hist?.levels.reduce((sum, l) => sum + l.amount, 0n);
  const executable = hist?.levels.some(
    (l) => state && l.tick <= state.tick && state.tick < l.tick + 1200,
  );
  function orderAction(o: Order) {
    if (o.cancelled || o.claimed) return null;
    return o.settlement.executed ? (
      <button
        className="small"
        disabled={!ready}
        onClick={() =>
          openReview({
            title: `Claim order #${o.id}`,
            description: `Receive ${formatUnits((o.settlement.ethOut * o.amount) / o.settlement.amount, 18)} ETH and ${formatUnits((o.settlement.unsold * o.amount) / o.settlement.amount, 18)} unsold STOP. This order can be claimed once.`,
            call: hookCall(c, "claim", [o.id]),
          })
        }
      >
        Claim proceeds
      </button>
    ) : (
      <button
        className="small"
        disabled={!ready}
        onClick={() =>
          openReview({
            title: `Cancel order #${o.id}`,
            description: `Cancel the open order and return ${formatUnits(o.amount, 18)} STOP to your wallet. Cancellation is only possible before execution.`,
            call: hookCall(c, "cancel", [o.id]),
          })
        }
      >
        Cancel order
      </button>
    );
  }
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a href="#" className="brand" aria-label="Stoploss home">
          <span className="mark" aria-hidden="true">
            S
          </span>
          Stoploss<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Primary">
          <a href="#orders">My orders</a>
          <a href="#about">How it works</a>
        </nav>
        <div className="wallet">
          <span className="network">
            <span aria-hidden="true">◉</span> {c.d.network.name}
          </span>
          <button
            className="connect"
            disabled={walletBusy || busy}
            onClick={wrongChain ? switchChain : connect}
          >
            {walletBusy
              ? "Opening wallet…"
              : wrongChain
                ? `Switch to ${c.d.network.name}`
                : account
                  ? short(account)
                  : "Connect wallet"}
          </button>
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <div>
            <p className="eyebrow">
              Stop-loss orders · {c.d.network.name} testnet
            </p>
            <h1>
              A little more control.
              <br />
              <span>A clear exit.</span>
            </h1>
            <p>
              Set a trigger. Escrow STOP. Claim the proceeds when your order
              executes.
            </p>
          </div>
          <div className="testnet-note">
            <span className="pill">Testnet experiment</span>
            <p>
              Made for {c.d.network.name}.<br />
              Use test ETH and STOP only.
            </p>
            <a href={c.d.network.faucets[0]} target="_blank" rel="noreferrer">
              Get test ETH <Arrow />
            </a>
          </div>
        </section>
        <div className="status-strip">
          <span
            className={`status-dot ${verified && !readError ? "ok" : ""}`}
            aria-hidden="true"
          />
          <span>
            {loading
              ? "Connecting to the pool…"
              : readError
                ? "RPC connection unavailable"
                : `Pool connected · Block ${state?.block.toLocaleString()}`}
          </span>
          <button
            className="text-button"
            onClick={() => setRevision((n) => n + 1)}
            disabled={loading || busy}
          >
            Refresh data <span aria-hidden="true">↻</span>
          </button>
        </div>
        {walletError && (
          <p className="notice error" role="alert">
            {walletError}
          </p>
        )}
        {wrongChain && (
          <p className="notice warning">
            Your wallet is on a different network. Use “Switch to{" "}
            {c.d.network.name}” above. If needed, your wallet will offer to add
            it.
          </p>
        )}
        {readError && (
          <div className="notice error" role="alert">
            <strong>Live data is unavailable.</strong> {readError}{" "}
            <span>Try Refresh data. Transaction controls stay disabled.</span>
          </div>
        )}
        <section className="metrics" aria-label="Pool overview">
          <div>
            <span className="label">STOP price</span>
            <strong>
              {state ? displayPrice(priceAtSqrt(state.sqrt)) : "—"}{" "}
              <small>ETH</small>
            </strong>
            <span className="muted">
              per 1 STOP{state && !fresh ? " · stale" : ""}
            </span>
          </div>
          <div>
            <span className="label">Open in stop orders</span>
            <strong>
              {openTotal !== undefined ? displayAmount(openTotal) : "—"}{" "}
              <small>STOP</small>
            </strong>
            <span className="muted">
              {hist
                ? `${hist.levels.length} active trigger levels`
                : "Waiting for order events"}
            </span>
          </div>
          <div>
            <span className="label">Current pool tick</span>
            <strong>{state?.tick.toLocaleString() ?? "—"}</strong>
            <span className="muted">0.30% pool fee · 60 tick spacing</span>
          </div>
        </section>
        <div className="workspace">
          <section className="panel order-panel" aria-labelledby="place-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">01 / Set your exit</p>
                <h2 id="place-title">Place a stop order</h2>
              </div>
              <span className="token-mark" aria-hidden="true">
                S
              </span>
            </div>
            <p className="section-description">
              Sell STOP when its ETH price falls to your trigger.
            </p>
            <form noValidate onSubmit={(e) => submitOrder(e)}>
              <div className="field-heading">
                <label htmlFor="order-amount">Amount to escrow</label>
                <span className="muted">
                  Balance:{" "}
                  {account && state ? displayAmount(state.balance) : "—"} STOP
                </span>
              </div>
              <div className="amount-field">
                <input
                  id="order-amount"
                  name="orderAmount"
                  inputMode="decimal"
                  placeholder="100.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setOrderError("");
                  }}
                  aria-invalid={orderInvalid === "order-amount" && !!orderError}
                  aria-describedby="order-help order-error"
                />
                <span>STOP</span>
              </div>
              <p id="order-help" className="hint">
                Minimum 1 STOP. Approval and placement are separate steps.
              </p>
              <div className="field-heading">
                <label htmlFor="trigger">Trigger tick</label>
                <button
                  type="button"
                  className="text-button"
                  disabled={!state}
                  onClick={() => {
                    if (state)
                      setTrigger(
                        String((Math.floor(state.tick / 60) + 1) * 60),
                      );
                  }}
                >
                  Use next level
                </button>
              </div>
              <input
                id="trigger"
                name="triggerTick"
                inputMode="numeric"
                placeholder="e.g. 600"
                value={trigger}
                onChange={(e) => {
                  setTrigger(e.target.value);
                  setOrderError("");
                }}
                aria-invalid={orderInvalid === "trigger" && !!orderError}
                aria-describedby="trigger-help order-error"
              />
              <p id="trigger-help" className="hint">
                Multiple of 60, above the current tick. Higher tick = lower STOP
                price.
              </p>
              <div className="order-preview">
                <span>Trigger price</span>
                <strong>
                  {/^-?\d+$/.test(trigger) && Math.abs(Number(trigger)) < 887272
                    ? `${displayPrice(priceAtTick(Number(trigger)))} ETH / STOP`
                    : "Choose a trigger tick"}
                </strong>
              </div>
              <p id="order-error" className="field-error" role="alert">
                {orderError}
              </p>
              <div className="steps">
                <button
                  type="button"
                  disabled={!ready || !approveNeeded}
                  onClick={(e) => submitOrder(e, true)}
                >
                  <span className="step-number" aria-hidden="true">
                    1
                  </span>
                  {!approveNeeded ? "STOP approved" : "Approve STOP"}
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={!ready || approveNeeded}
                >
                  <span className="step-number" aria-hidden="true">
                    2
                  </span>
                  Place order <Arrow />
                </button>
              </div>
              <p className="hint prerequisites">{blocked}</p>
            </form>
            <div className="inset-note">
              <strong>
                Your tokens stay in the hook until you cancel or claim.
              </strong>
              <p>
                Execution may leave unsold STOP. Proceeds and unsold tokens are
                claimed together; tiny rounding amounts stay in the hook.
              </p>
            </div>
          </section>
          <section className="panel swap-panel" aria-labelledby="swap-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">02 / Trade the pool</p>
                <h2 id="swap-title">Swap</h2>
              </div>
              <span className="pill neutral">ETH / STOP</span>
            </div>
            <div className="segmented" aria-label="Swap direction">
              <button
                aria-pressed={buy}
                disabled={busy || quoting}
                onClick={() => {
                  setBuy(true);
                  setQuote(undefined);
                  setSwapError("");
                }}
              >
                Buy STOP
              </button>
              <button
                aria-pressed={!buy}
                disabled={busy || quoting}
                onClick={() => {
                  setBuy(false);
                  setQuote(undefined);
                  setSwapError("");
                }}
              >
                Sell STOP
              </button>
            </div>
            <form noValidate onSubmit={getQuote}>
              <div className="field-heading">
                <label htmlFor="swap-amount">You pay</label>
                <span className="muted">
                  Balance:{" "}
                  {account && state
                    ? displayAmount(buy ? state.nativeBalance : state.balance)
                    : "—"}
                </span>
              </div>
              <div className="amount-field">
                <input
                  id="swap-amount"
                  name="swapAmount"
                  inputMode="decimal"
                  placeholder={buy ? "0.01" : "10.00"}
                  value={swapAmount}
                  disabled={quoting}
                  onChange={(e) => {
                    setSwapAmount(e.target.value);
                    setQuote(undefined);
                    setSwapError("");
                  }}
                  aria-describedby="swap-error"
                />
                <span>{buy ? "ETH" : "STOP"}</span>
              </div>
              <div className="swap-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="receive">
                <span className="label">Estimated receive</span>
                <strong>
                  {quote ? displayAmount(quote.out) : "—"}{" "}
                  <small>{buy ? "STOP" : "ETH"}</small>
                </strong>
              </div>
              <div className="tolerance">
                <label htmlFor="tolerance">Price tolerance</label>
                <div>
                  <input
                    id="tolerance"
                    name="priceTolerance"
                    inputMode="decimal"
                    value={tolerance}
                    disabled={quoting}
                    onChange={(e) => {
                      setTolerance(e.target.value);
                      setQuote(undefined);
                    }}
                    aria-describedby="price-help swap-error"
                  />
                  <span>%</span>
                </div>
              </div>
              <p id="price-help" className="hint">
                0.01–5%. Limits the execution price, not a guaranteed minimum
                received. Partial fills are possible on chain.
              </p>
              <p id="swap-error" className="field-error" role="alert">
                {swapError}
              </p>
              <button className="wide" type="submit" disabled={!ready}>
                {quoting
                  ? "Getting quote…"
                  : quote
                    ? "Refresh quote"
                    : "Get quote"}{" "}
                <Arrow />
              </button>
            </form>
            {quote && (
              <div className="quote-details">
                <p>
                  {quoteFresh
                    ? `Quote expires in ${Math.max(0, Math.ceil((60000 - (now - quote.at)) / 1000))}s.`
                    : "Quote expired. Get a new quote."}{" "}
                  Estimated gas: {quote.gas.toLocaleString()} units.
                </p>
                {!buy && state && state.swapAllowance < quote.amount ? (
                  <button
                    className="wide"
                    disabled={!ready || !quoteFresh}
                    onClick={() =>
                      openReview({
                        title: "Approve STOP for swaps",
                        description: `Allow PoolSwapTest to spend exactly ${formatUnits(quote.amount, 18)} STOP. This is separate from your order approval.`,
                        call: tokenCall(c, "approve", [
                          c.d.integrations.poolSwapTest,
                          quote.amount,
                        ]),
                      })
                    }
                  >
                    Approve STOP for swap
                  </button>
                ) : (
                  <button
                    className="wide"
                    disabled={!ready || !quoteFresh}
                    onClick={() =>
                      openReview({
                        title: buy ? "Buy STOP" : "Sell STOP",
                        description: `Pay up to ${formatUnits(quote.amount, 18)} ${buy ? "ETH" : "STOP"} for an estimated ${formatUnits(quote.out, 18)} ${buy ? "STOP" : "ETH"}. Price tolerance ${quote.bps / 100}%. PoolSwapTest has no output guarantee or deadline. A later on-chain partial fill is possible.`,
                        call: swapCall(c, quote),
                        quote,
                      })
                    }
                  >
                    Review swap <Arrow />
                  </button>
                )}
              </div>
            )}
            <p className="hint">
              {!account
                ? "Connect your wallet to quote and swap."
                : wrongChain
                  ? `Switch to ${c.d.network.name} to quote and swap.`
                  : "Keep ETH in your wallet for gas."}{" "}
              Sells can execute up to five stop levels; the seller pays that
              gas.
            </p>
            <div className="route">
              Route{" "}
              <AddressLink
                c={c}
                address={c.d.integrations.poolSwapTest}
                label="PoolSwapTest"
              />
            </div>
          </section>
        </div>
        <section className="panel levels" aria-labelledby="levels-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">The order book</p>
              <h2 id="levels-title">Open STOP by trigger</h2>
            </div>
            <button
              disabled={!ready || !executable || !!eventStatus || !!eventError}
              onClick={() =>
                openReview({
                  title: "Execute eligible levels",
                  description:
                    "Catch up at most five open levels at or below the current tick, within their price window. Anyone can call this function and pay its gas. More calls may be needed.",
                  call: hookCall(c, "execute", [c.key, 5n]),
                  execute: true,
                })
              }
            >
              Execute up to 5 levels <Arrow />
            </button>
          </div>
          <p className="hint">
            Levels are discovered from OrderPlaced events and checked against
            live openAmount. Skipped levels remain open and cancellable.
          </p>
          <div className="event-progress" role="status">
            {eventStatus}
          </div>
          {eventError && (
            <p className="notice error" role="alert">
              Order history could not be loaded. {eventError} Refresh data to
              retry; no empty balance is assumed.
            </p>
          )}
          {!hist && !eventError ? (
            <div className="empty">
              <span aria-hidden="true">≋</span>
              <p>Waiting for live trigger levels.</p>
            </div>
          ) : hist?.levels.length === 0 ? (
            <div className="empty">
              <span aria-hidden="true">≋</span>
              <strong>No open levels yet</strong>
              <p>Place an order to create a trigger level.</p>
            </div>
          ) : (
            hist && (
              <div className="level-list">
                {hist.levels.map((l) => (
                  <div className="level-row" key={l.tick}>
                    <div>
                      <strong>
                        {displayPrice(priceAtTick(l.tick))}{" "}
                        <small>ETH / STOP</small>
                      </strong>
                      <span className="muted">
                        Tick {l.tick} ·{" "}
                        {state && l.tick <= state.tick
                          ? state.tick >= l.tick + 1200
                            ? "Outside price window"
                            : "Eligible for execution"
                          : "Waiting for price"}
                      </span>
                    </div>
                    <div className="level-amount">
                      <strong title={formatUnits(l.amount, 18)}>
                        {displayAmount(l.amount)} STOP
                      </strong>
                      <div className="bar">
                        <span
                          style={{
                            width: `${Math.max(2, Number((l.amount * 100n) / (openTotal || 1n)))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </section>
        <section
          id="orders"
          className="panel orders"
          aria-labelledby="orders-title"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">03 / Stay in control</p>
              <h2 id="orders-title">
                My orders{" "}
                {account && hist && <span className="count">{hist.total}</span>}
              </h2>
            </div>
            {account && (
              <span className="account-label" title={account}>
                {short(account)}
              </span>
            )}
          </div>
          {!account ? (
            <div className="empty">
              <span aria-hidden="true">↳</span>
              <strong>Your orders, in one place.</strong>
              <p>
                Connect your wallet to see open orders and claimable proceeds.
              </p>
              <button disabled={walletBusy} onClick={connect}>
                Connect wallet <Arrow />
              </button>
            </div>
          ) : !hist ? (
            <div className="empty">
              <p>
                {eventError
                  ? "Order history is unavailable. Refresh data to retry."
                  : "Reading your orders from contract events…"}
              </p>
            </div>
          ) : hist.orders.length === 0 ? (
            <div className="empty">
              <strong>No orders for this wallet</strong>
              <p>Start with an amount of STOP and a trigger tick above.</p>
              <a href="#place-title">
                Place your first order <Arrow />
              </a>
            </div>
          ) : (
            <div className="order-list">
              {hist.orders.map((o) => (
                <article className="order-row" key={String(o.id)}>
                  <div>
                    <strong>Order #{String(o.id)}</strong>
                    <span className="pill neutral">
                      {o.cancelled
                        ? "Cancelled"
                        : o.claimed
                          ? "Claimed"
                          : o.settlement.executed
                            ? "Ready to claim"
                            : "Open"}
                    </span>
                  </div>
                  <div>
                    <strong title={formatUnits(o.amount, 18)}>
                      {displayAmount(o.amount)} STOP
                    </strong>
                    <span className="muted">
                      Tick {o.triggerTick} · Epoch {String(o.epoch)}
                    </span>
                  </div>
                  <div className="order-proceeds">
                    {o.settlement.executed && !o.cancelled ? (
                      <>
                        <strong>
                          {displayAmount(
                            (o.settlement.ethOut * o.amount) /
                              o.settlement.amount,
                          )}{" "}
                          ETH
                        </strong>
                        <span className="muted">
                          +{" "}
                          {displayAmount(
                            (o.settlement.unsold * o.amount) /
                              o.settlement.amount,
                          )}{" "}
                          unsold STOP
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {displayPrice(priceAtTick(o.triggerTick))}
                        </strong>
                        <span className="muted">ETH / STOP trigger</span>
                      </>
                    )}
                  </div>
                  <div>{orderAction(o)}</div>
                </article>
              ))}
            </div>
          )}
          {hist && hist.total > hist.orders.length && (
            <button
              disabled={!!eventStatus}
              onClick={() => setLimit((n) => n + 50)}
            >
              Load 50 older orders
            </button>
          )}
          {hist && (
            <p className="hint">
              State checked at block {hist.block.toLocaleString()}. Refreshes
              every 30 seconds; transactions check current eligibility.
            </p>
          )}
        </section>
        <section id="about" className="about">
          <div>
            <p className="eyebrow">Know your order</p>
            <h2>
              Automatic execution.
              <br />
              You make the final claim.
            </h2>
            <p>
              A stop is a trigger, not a guaranteed sale price. No keeper or
              backend is required.
            </p>
          </div>
          <div className="explain">
            <div>
              <span>01</span>
              <p>
                <strong>Sells move the tick up.</strong> A sell crossing your
                trigger can execute its bucket. Buys never trigger stop orders.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Each level shares an epoch.</strong> Up to five levels
                execute per sell. Anyone can execute eligible remaining levels.
                The limit is 1,200 ticks beyond the trigger, about 11% lower in
                ETH price.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Claim both assets.</strong> ETH proceeds and unsold STOP
                are split by your share of the epoch, rounded down. There is no
                hook fee or administrator.
              </p>
            </div>
          </div>
        </section>
        <details className="deployment-details">
          <summary>Deployment &amp; contract details</summary>
          <div className="details-grid">
            <div>
              <span className="label">Connected account</span>
              <code>{account ?? "No wallet connected"}</code>
              <span className="label">Pool ID</span>
              <code>{c.poolId}</code>
              <span className="label">Source commit</span>
              <code>{c.d.sourceCommit}</code>
              <span className="label">Attestation</span>
              <code>{c.d.attestationHash}</code>
            </div>
            <div className="contract-links">
              {c.d.contracts.map((contract) => (
                <AddressLink
                  key={contract.name}
                  c={c}
                  address={contract.address}
                  label={`${contract.name} · ${contract.address}`}
                />
              ))}
              <AddressLink
                c={c}
                address={c.d.network.uniswapV4.poolManager}
                label="Uniswap v4 PoolManager"
              />
              <AddressLink
                c={c}
                address={c.d.network.uniswapV4.stateView}
                label="StateView"
              />
              <AddressLink
                c={c}
                address={c.d.network.uniswapV4.quoter}
                label="V4Quoter"
              />
              <AddressLink
                c={c}
                address={c.d.integrations.poolSwapTest}
                label="PoolSwapTest"
              />
              <a href="./imd-deployment.json">
                View deployment manifest <Arrow />
              </a>
              <p className="hint">
                {state
                  ? `${displayAmount(state.totalSupply)} STOP total supply · ${state.decimals} decimals`
                  : "Token supply loads from chain."}{" "}
                The hook ignores hookData. This interface sends empty hookData.
              </p>
            </div>
          </div>
        </details>
        <div className="transaction-status" role="status">
          {!review && txStatus && (
            <p>
              {txStatus}{" "}
              {txHash && (
                <a
                  href={`${c.d.network.explorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <Arrow />
                </a>
              )}
            </p>
          )}
        </div>
        {!review && txError && (
          <p className="notice error" role="alert">
            {txError}
          </p>
        )}
      </main>
      <footer>
        <a href="#" className="brand">
          Stoploss<span className="brand-dot">.</span>
        </a>
        <span>A permissionless experiment on {c.d.network.name}.</span>
        <span>
          Built on Uniswap v4 <Arrow />
        </span>
      </footer>
      <dialog
        ref={dialog}
        aria-labelledby="review-title"
        aria-describedby="review-description"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setReview(undefined);
        }}
        onClose={() => {
          if (!busy) setReview(undefined);
        }}
      >
        <div className="dialog-content">
          <p className="eyebrow">Review transaction · {c.d.network.name}</p>
          <h2 id="review-title">{review?.title}</h2>
          <p id="review-description">{review?.description}</p>
          <div className="inset-note">
            Wallet: <code>{account}</code>
            {review && (
              <>
                <br />
                Contract:{" "}
                <AddressLink
                  c={c}
                  address={review.call.address}
                  label={short(review.call.address)}
                />
              </>
            )}
          </div>
          <p className="hint">
            Your wallet will show the network fee before signing. No transaction
            is sent until you confirm there.
          </p>
          <p role="status">{txStatus}</p>
          {txHash && (
            <a
              href={`${c.d.network.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View submitted transaction <Arrow />
            </a>
          )}
          <p className="field-error" role="alert">
            {txError}
          </p>
          <div className="dialog-actions">
            <button
              data-dialog-back
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Go back
            </button>
            <button
              className="primary"
              disabled={!ready || !!txHash}
              onClick={confirm}
            >
              {busy ? "Transaction in progress…" : "Confirm in wallet"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
