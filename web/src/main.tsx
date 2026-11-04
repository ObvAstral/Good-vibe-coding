import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  WagmiProvider,
  createConfig,
  http,
  useConnect,
  useConnection,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useSignTypedData,
  useBalance,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, formatEther, type Address } from "viem";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  buyerAuthorization,
  PROTOCOL_VERSION,
  type PurchaseInput,
  type PurchaseResult,
  type Deployment,
  type Point,
  type Quote,
  type DepositResult,
} from "@riciclo/shared";
import { api, HttpError, message } from "./api.js";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/libre-baskerville/latin-400.css";
import "@fontsource/libre-baskerville/latin-700.css";
import "@fontsource/source-code-pro/latin-400.css";
import "./style.css";

type Config = { deployment: Deployment; rpcUrl: string; points: Point[] };
type Pending = {
  requestId: string;
  recipient: Address;
  machineId: string;
  bottles: number;
};
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function App({ runtime }: { runtime: Config }) {
  const connection = useConnection();
  const { address, chainId, isConnected } = connection;
  const connect = useConnect(),
    disconnect = useDisconnect(),
    switchChain = useSwitchChain(),
    sign = useSignTypedData();
  const query = useQueryClient();
  const contract = {
    address: runtime.deployment.contractAddress,
    abi: tokenAbi,
  };
  const balance = useReadContract({
    ...contract,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: runtime.deployment.chainId,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const eth = useBalance({
    address,
    chainId: runtime.deployment.chainId,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const products = useReadContract({
    ...contract,
    functionName: "getProducts",
    chainId: runtime.deployment.chainId,
    query: { refetchInterval: 10000 },
  });
  const [page, setPage] = useState(
    location.pathname === "/supermercato" ? "store" : "machine",
  );
  const [points, setPoints] = useState(runtime.points);
  const machines = points.filter((p) => p.kind === 0 && p.active),
    stores = points.filter((p) => p.kind === 1 && p.active);
  const [machineId, setMachineId] = useState(machines[0]?.id ?? ""),
    [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [bottles, setBottles] = useState(10),
    [cart, setCart] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [hash, setHash] = useState<string | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [now, setNow] = useState(Date.now());
  const [pendingPurchase, setPendingPurchase] = useState<PurchaseInput | null>(
    null,
  );
  const processing = busy || !!pendingPurchase;
  const action = useRef(false);
  const storageKey = address
    ? `riciclo:${runtime.deployment.chainId}:${runtime.deployment.contractAddress}:${runtime.deployment.deploymentBlockHash}:${address.toLowerCase()}`
    : null;
  const purchaseStorageKey = storageKey ? `${storageKey}:purchase` : null;
  const context = `${address}:${chainId}:${storeId}:${JSON.stringify(cart)}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const ready = isConnected && chainId === runtime.deployment.chainId;
  const items = Object.entries(cart)
    .filter(([, n]) => n > 0)
    .map(([productId, quantity]) => ({ productId, quantity }));
  const total = (products.data ?? []).reduce(
    (sum, p) => sum + p.price * BigInt(cart[p.id.toString()] ?? 0),
    0n,
  );
  const expired = !!quote && Number(quote.deadline) * 1000 <= now;
  function savePending(value: Pending | null) {
    if (storageKey) {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    }
    setPending(value);
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setQuote(null);
  }, [context]);
  useEffect(() => {
    setNotice("");
    setHash(null);
    try {
      setPending(
        storageKey
          ? JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
          : null,
      );
    } catch {
      setPending(null);
    }
  }, [storageKey]);
  useEffect(() => {
    const change = () =>
      setPage(location.pathname === "/supermercato" ? "store" : "machine");
    addEventListener("popstate", change);
    return () => removeEventListener("popstate", change);
  }, []);
  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      api<Config>("/api/config")
        .then((c) => {
          if (live) setPoints(c.points);
        })
        .catch(() => {});
    }, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!pending || !storageKey) return;
    let live = true,
      running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        let result: DepositResult;
        try {
          result = await api(`/api/deposits/${pending.requestId}`);
        } catch (error) {
          if (error instanceof HttpError && error.status === 404)
            result = await api("/api/deposits", pending);
          else throw error;
        }
        if (!live) return;
        setHash(result.txHash);
        if (result.status === "confirmed") {
          sessionStorage.removeItem(storageKey);
          setPending(null);
          setNotice(`Deposito confermato: ${pending.bottles} RCS accreditati.`);
          void query.invalidateQueries();
        } else if (result.status === "failed") {
          sessionStorage.removeItem(storageKey);
          setPending(null);
          setNotice(result.error ?? "Deposito fallito.");
        } else
          setNotice(
            result.error ?? "Deposito in attesa di conferma sulla blockchain.",
          );
      } catch (error) {
        if (live)
          setNotice(
            `${message(error)} La richiesta resta salvata per il recupero.`,
          );
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pending, storageKey, query]);
  useEffect(() => {
    try {
      setPendingPurchase(
        purchaseStorageKey
          ? JSON.parse(sessionStorage.getItem(purchaseStorageKey) ?? "null")
          : null,
      );
    } catch {
      setPendingPurchase(null);
    }
  }, [purchaseStorageKey]);
  useEffect(() => {
    if (!pendingPurchase || !purchaseStorageKey) return;
    let live = true,
      running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const q = pendingPurchase.quote;
        let result: PurchaseResult;
        try {
          result = await api(`/api/purchases/${q.buyer}/${q.nonce}`);
        } catch (error) {
          if (error instanceof HttpError && error.status === 404)
            result = await api("/api/purchases", pendingPurchase);
          else throw error;
        }
        if (!live) return;
        setHash(result.txHash);
        if (result.status === "confirmed" || result.status === "failed") {
          sessionStorage.removeItem(purchaseStorageKey);
          setPendingPurchase(null);
          setQuote(null);
          if (result.status === "confirmed") {
            setCart({});
            setNotice(
              `Acquisto confermato: ${q.maxTotal} RCS utilizzati. Commissioni pagate dal supermercato.`,
            );
            void query.invalidateQueries();
          } else setNotice(result.error ?? "Acquisto fallito.");
        } else
          setNotice(
            result.error ??
              "Il supermercato sta completando l’acquisto. Attendo la conferma sulla blockchain…",
          );
      } catch (error) {
        if (live) {
          setNotice(message(error));
          if (
            error instanceof HttpError &&
            [400, 409, 422].includes(error.status)
          ) {
            sessionStorage.removeItem(purchaseStorageKey);
            setPendingPurchase(null);
            setQuote(null);
          }
        }
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pendingPurchase, purchaseStorageKey, query]);
  function navigate(target: "machine" | "store") {
    history.pushState(
      {},
      "",
      target === "machine" ? "/macchinetta" : "/supermercato",
    );
    setPage(target);
    setQuote(null);
    setNotice("");
    setHash(null);
  }
  async function deposit() {
    if (!address || !ready || action.current || pending) return;
    action.current = true;
    setBusy(true);
    setNotice("Invio del deposito…");
    setHash(null);
    const input: Pending = {
      requestId: crypto.randomUUID(),
      recipient: address,
      machineId,
      bottles,
    };
    savePending(input);
    try {
      const result = await api<DepositResult>("/api/deposits", input);
      setHash(result.txHash);
    } catch (error) {
      setNotice(message(error));
      if (error instanceof HttpError && error.status === 400) savePending(null);
    } finally {
      setBusy(false);
      action.current = false;
    }
  }
  async function requestQuote() {
    if (!address || !ready || action.current) return;
    action.current = true;
    setBusy(true);
    setQuote(null);
    setNotice("Preparazione del preventivo…");
    setHash(null);
    const captured = context;
    try {
      const result = await api<Quote>("/api/purchase-quotes", {
        buyer: address,
        storeId,
        cart: items,
      });
      if (contextRef.current === captured) {
        setQuote(result);
        setNotice(
          "Preventivo pronto. Controlla il totale e autorizza la spesa nel wallet.",
        );
      }
    } catch (error) {
      if (contextRef.current === captured) setNotice(message(error));
    } finally {
      setBusy(false);
      action.current = false;
    }
  }
  async function purchase() {
    if (
      !quote ||
      expired ||
      !address ||
      !ready ||
      action.current ||
      pendingPurchase
    )
      return;
    action.current = true;
    setBusy(true);
    setNotice(
      "Autorizza nel wallet la spesa dei crediti. Il supermercato pagherà le commissioni.",
    );
    setHash(null);
    const captured = context;
    try {
      const buyerSignature = await sign.mutateAsync(
        buyerAuthorization(quote, runtime.deployment),
      );
      if (contextRef.current !== captured) return;
      const input: PurchaseInput = { quote, buyerSignature };
      if (purchaseStorageKey)
        sessionStorage.setItem(purchaseStorageKey, JSON.stringify(input));
      setPendingPurchase(input);
      const result = await api<PurchaseResult>("/api/purchases", input);
      if (contextRef.current === captured) {
        setHash(result.txHash);
        setQuote(null);
      }
    } catch (error) {
      if (contextRef.current === captured) {
        setNotice(message(error));
        if (
          error instanceof HttpError &&
          [400, 409, 422].includes(error.status)
        ) {
          if (purchaseStorageKey) sessionStorage.removeItem(purchaseStorageKey);
          setPendingPurchase(null);
          setQuote(null);
        }
      }
    } finally {
      setBusy(false);
      action.current = false;
    }
  }
  const selected = (page === "machine" ? machines : stores).find(
    (p) => p.id === (page === "machine" ? machineId : storeId),
  );
  return (
    <>
      <a className="skip-link" href="#contenuto">
        Vai al contenuto
      </a>
      <header>
        <a
          className="brand"
          href="/macchinetta"
          onClick={(e) => {
            e.preventDefault();
            navigate("machine");
          }}
        >
          <span>
            Riciclo<span className="brand-light"> Solidale</span>
          </span>
        </a>
        <span className="network">Hardhat · rete locale</span>
      </header>
      <main id="contenuto" tabIndex={-1}>
        <section className="intro" aria-labelledby="page-title">
          <div className="eyebrow">PICCOLI GESTI, RISORSE CONDIVISE</div>
          <h1 id="page-title">
            Ogni bottiglia
            <br />
            può fare la differenza.
          </h1>
          <p>
            Conferisci bottiglie, ricevi crediti RCS e usali nei negozi
            aderenti.
          </p>
        </section>
        <section className="wallet" aria-label="Wallet">
          <div>
            <span className="label">IL TUO SALDO</span>
            <div className="balance" data-testid="balance">
              {address ? (balance.data?.toString() ?? "…") : "—"}{" "}
              <span>RCS</span>
            </div>
            <p>
              {address
                ? `${short(address)} · ${eth.data ? Number(formatEther(eth.data.value)).toFixed(4) : "…"} ETH`
                : "Collega il wallet per iniziare."}
            </p>
          </div>
          <div>
            {isConnected ? (
              <button
                className="secondary"
                disabled={processing}
                onClick={() => disconnect.mutate()}
              >
                Disconnetti
              </button>
            ) : (
              <button
                onClick={() => {
                  setNotice("");
                  connect.mutate(
                    { connector: connect.connectors[0] },
                    { onError: (error) => setNotice(message(error)) },
                  );
                }}
                disabled={connect.isPending || !connect.connectors.length}
              >
                {connect.isPending ? "Connessione…" : "Collega MetaMask"}
              </button>
            )}
          </div>
        </section>
        {!isConnected && typeof (window as any).ethereum === "undefined" && (
          <p className="hint">
            Per continuare, installa MetaMask e ricarica la pagina.
          </p>
        )}
        {isConnected && !ready && (
          <div className="warning" role="alert">
            Il wallet è collegato a una rete diversa.{" "}
            <button
              className="secondary"
              onClick={() =>
                switchChain.mutate(
                  { chainId: runtime.deployment.chainId },
                  { onError: (error) => setNotice(message(error)) },
                )
              }
            >
              Passa alla rete della demo
            </button>
          </div>
        )}
        <nav aria-label="Operazioni">
          <button
            className={page === "machine" ? "tab active" : "tab"}
            aria-current={page === "machine" ? "page" : undefined}
            onClick={() => navigate("machine")}
            disabled={processing}
          >
            01 <span>Conferisci bottiglie</span>
          </button>
          <button
            className={page === "store" ? "tab active" : "tab"}
            aria-current={page === "store" ? "page" : undefined}
            onClick={() => navigate("store")}
            disabled={processing}
          >
            02 <span>Usa i tuoi crediti</span>
          </button>
        </nav>
        <section className="panel" aria-labelledby="operation-title">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">
                {page === "machine" ? "LA MACCHINETTA" : "IL SUPERMERCATO"}
              </div>
              <h2 id="operation-title">
                {page === "machine"
                  ? "Dai valore al tuo riciclo."
                  : "Scegli la tua spesa."}
              </h2>
            </div>
          </div>
          <label className="field">
            {page === "machine" ? "Punto di raccolta" : "Negozio aderente"}
            <select
              value={page === "machine" ? machineId : storeId}
              disabled={processing || (page === "machine" && !!pending)}
              onChange={(e) =>
                page === "machine"
                  ? setMachineId(e.target.value)
                  : setStoreId(e.target.value)
              }
            >
              {(page === "machine" ? machines : stores).map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · Quartiere {p.neighborhoodName} · Circoscrizione{" "}
                  {p.zoneId}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <p className="point">
              <span className="point-name">{selected.name}</span>
              <span className="point-location">
                Torino · Quartiere {selected.neighborhoodName} · Circoscrizione{" "}
                {selected.zoneId}
              </span>
            </p>
          ) : (
            <p className="warning">
              Nessun punto attivo disponibile. Seleziona un punto valido.
            </p>
          )}
          {page === "machine" ? (
            <>
              <div className="deposit-row">
                <label className="field">
                  Bottiglie conferite
                  <input
                    aria-label="Bottiglie conferite"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={bottles}
                    disabled={processing || !!pending}
                    onChange={(e) =>
                      setBottles(
                        Math.max(
                          0,
                          Math.min(100, Math.trunc(Number(e.target.value))),
                        ),
                      )
                    }
                  />
                </label>
                <div className="conversion">
                  <strong>{bottles} RCS</strong>
                  <span>1 bottiglia = 1 credito</span>
                </div>
              </div>
              <p className="hint">
                Da 1 a 100 bottiglie per conferimento. Il punto di raccolta paga
                il gas dell’accredito.
              </p>
              <button
                className="full"
                disabled={
                  !ready || !selected || bottles < 1 || processing || !!pending
                }
                onClick={() => void deposit()}
              >
                {pending
                  ? "Deposito in attesa…"
                  : processing
                    ? "Invio…"
                    : "Conferma conferimento"}
              </button>
            </>
          ) : (
            <>
              {products.error && (
                <p className="warning">
                  Catalogo non disponibile. Controlla la connessione alla rete.
                </p>
              )}
              <div className="products">
                {(products.data ?? []).map((p) => (
                  <div className="product" key={p.id.toString()}>
                    <div>
                      <h3>{p.name}</h3>
                      <span>{p.price.toString()} RCS / articolo</span>
                    </div>
                    <label>
                      Quantità
                      <input
                        aria-label={`Quantità ${p.name}`}
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={cart[p.id.toString()] ?? 0}
                        disabled={processing}
                        onChange={(e) =>
                          setCart({
                            ...cart,
                            [p.id.toString()]: Math.max(
                              0,
                              Math.min(100, Math.trunc(Number(e.target.value))),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="total">
                <span>Totale carrello</span>
                <strong>{total.toString()} RCS</strong>
              </div>
              {items.length > 4 && (
                <p className="warning">
                  Puoi acquistare al massimo quattro prodotti distinti.
                </p>
              )}
              {balance.data !== undefined && total > balance.data && (
                <p className="warning">
                  Crediti insufficienti. Conferisci altre bottiglie per
                  completare questa spesa.
                </p>
              )}
              {quote && (
                <div className="quote">
                  <strong>Totale confermato: {quote.maxTotal} RCS</strong>
                  <span>
                    {expired
                      ? "Preventivo scaduto. Richiedine uno nuovo."
                      : `Valido per altri ${Math.max(0, Math.ceil((Number(quote.deadline) * 1000 - now) / 1000))} secondi.`}
                  </span>
                </div>
              )}
              <div className="actions">
                <button
                  className="secondary"
                  disabled={
                    !ready ||
                    !selected ||
                    processing ||
                    items.length === 0 ||
                    items.length > 4 ||
                    balance.data === undefined ||
                    total > balance.data
                  }
                  onClick={() => void requestQuote()}
                >
                  {quote ? "Aggiorna preventivo" : "Richiedi preventivo"}
                </button>
                <button
                  disabled={
                    !ready || !selected || processing || !quote || expired
                  }
                  onClick={() => void purchase()}
                >
                  {processing ? "Operazione in corso…" : "Conferma acquisto"}
                </button>
              </div>
              <p className="hint">
                Il supermercato paga le commissioni dell’acquisto. Tu autorizzi
                soltanto la spesa dei crediti RCS.
              </p>
            </>
          )}
        </section>
        {notice && (
          <div className="notice" role="status" aria-live="polite">
            {notice}
          </div>
        )}
        {hash && (
          <p className="transaction">
            Transazione <code data-testid="tx-hash">{hash}</code>
          </p>
        )}
        <footer>
          <strong>Una demo di economia solidale.</strong>
          <p>
            I conferimenti sono simulati. I crediti RCS non sono euro e non sono
            trasferibili tra wallet.
          </p>
        </footer>
      </main>
    </>
  );
}
async function bootstrap() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const runtime = await api<Config>("/api/config");
    if (runtime.deployment.protocolVersion !== PROTOCOL_VERSION)
      throw new Error(
        "La demo richiede il contratto di protocollo 3 con punti fissi e quartieri.",
      );
    const chain = defineChain({
      id: runtime.deployment.chainId,
      name: "Hardhat locale",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [runtime.rpcUrl] } },
    });
    const config = createConfig({
      chains: [chain],
      connectors: [injected()],
      transports: { [chain.id]: http(runtime.rpcUrl) },
    });
    root.render(
      <React.StrictMode>
        <WagmiProvider config={config}>
          <QueryClientProvider client={new QueryClient()}>
            <App runtime={runtime} />
          </QueryClientProvider>
        </WagmiProvider>
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <main className="startup">
        <h1>Riciclo Solidale</h1>
        <p role="alert">{message(error)}</p>
        <p>Avvia blockchain e backend dopo il deploy del contratto.</p>
        <button onClick={() => location.reload()}>Riprova</button>
      </main>,
    );
  }
}
void bootstrap();
