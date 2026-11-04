import { createHash } from "node:crypto";
import { FIXED_POINTS, NEIGHBORHOODS } from "@riciclo/shared";
import { aggregateFixture, type PlannerEvent } from "./planner-fixtures.js";

export const HISTORY_DEFAULTS = {
  seed: 314159,
  start: "2026-05-05",
  days: 180,
  operations: 5000,
  customers: 120,
} as const;
export const HISTORY_PRODUCTS = [
  { id: "1", name: "Acqua", price: "1" },
  { id: "2", name: "Pane", price: "2" },
  { id: "3", name: "Prosciutto", price: "4" },
  { id: "4", name: "Tonno", price: "3" },
];
export type HistoryOptions = { [K in keyof typeof HISTORY_DEFAULTS]:
  K extends "start" ? string : number };
export interface HistoryOperation {
  sequence: number;
  day: number;
  timestamp: number;
  kind: "deposit" | "purchase";
  pointId: string;
  customerIndex: number;
  amount: string;
  productIds: string[];
  quantities: string[];
  purchaseNonce: string | null;
}
export interface HistoryControl {
  day: number;
  timestamp: number;
  pointId: string;
  active: boolean;
}
export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
export const dayString = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
export const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export function historyPlan(options: HistoryOptions) {
  for (const field of ["seed", "days", "operations", "customers"] as const)
    if (!Number.isSafeInteger(options[field])) throw new Error(`Parametro ${field} non intero.`);
  if (options.seed < 0 || options.seed > 0xffffffff || options.days < 6 ||
      options.days > 366 || options.operations < options.days * 2 ||
      options.operations > 50000 || options.customers < 2 || options.customers > 500)
    throw new Error("Limiti: seed uint32, 6–366 giorni, 2 operazioni/giorno–50.000 totali, 2–500 clienti.");
  const start = Date.parse(`${options.start}T00:00:00.000Z`) / 1000;
  if (!Number.isInteger(start) || dayString(start) !== options.start)
    throw new Error("Data iniziale non valida: usare YYYY-MM-DD.");
  let state = options.seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[], weight: (item: T) => number): T => {
    const weights = items.map(weight);
    let cursor = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) {
      cursor -= weights[i];
      if (cursor < 0) return items[i];
    }
    return items[items.length - 1];
  };
  const controls: HistoryControl[] = [
    { day: Math.floor(options.days * .45), pointId: "10", active: false },
    { day: Math.floor(options.days * .60), pointId: "10", active: true },
  ].map(c => ({ ...c, timestamp: start + c.day * 86400 }));
  const days = Array.from({ length: options.days }, (_, day) => day);
  const dailyCounts = days.map(() => 2);
  for (let i = options.days * 2; i < options.operations; i++) {
    const day = pick(days, d => [0, 6].includes(new Date((start + d * 86400) * 1000).getUTCDay()) ? .8 : 1.15);
    dailyCounts[day]++;
  }
  const weight = (neighborhoodId: number, day: number) => {
    const progress = day / (options.days - 1);
    if (neighborhoodId === 7) return 1 + progress * 2.8;
    if (neighborhoodId === 11) return 2.7 - progress * 2.3;
    if (neighborhoodId === 2) return .8 + Math.max(0, progress - .5) * 5;
    if (neighborhoodId === 18) return 2;
    if (neighborhoodId === 23) return .65;
    return 1.1;
  };
  const balances = Array<bigint>(options.customers).fill(0n);
  const nonces = Array<bigint>(options.customers).fill(0n);
  const operations: HistoryOperation[] = [];
  for (const day of days) {
    for (let i = 0; i < dailyCounts[day]; i++) {
      let customerIndex = Math.floor(random() * options.customers);
      const productIds: string[] = [], quantities: string[] = [];
      let total = 0n;
      for (const product of HISTORY_PRODUCTS) {
        if (random() < .45) {
          const q = 1 + Math.floor(random() * 4);
          productIds.push(product.id);
          quantities.push(String(q));
          total += BigInt(product.price) * BigInt(q);
        }
      }
      if (!productIds.length) { productIds.push("1"); quantities.push("1"); total = 1n; }
      const eligible = balances.flatMap((b, c) => b >= total ? [c] : []);
      const purchase = random() < .44 && eligible.length > 0;
      if (purchase) customerIndex = eligible[Math.floor(random() * eligible.length)];
      const points = FIXED_POINTS.filter(p =>
        p.kind === (purchase ? 1 : 0) &&
        !(p.id === "10" && day >= controls[0].day && day < controls[1].day));
      const point = pick(points, p => weight(p.neighborhoodId, day));
      const amount = purchase ? total : BigInt(5 + Math.floor(random() * 26));
      operations.push({
        sequence: operations.length + 1,
        day,
        timestamp: start + day * 86400 + 3600 + Math.floor((i + 1) * 75600 / (dailyCounts[day] + 1)),
        kind: purchase ? "purchase" : "deposit",
        pointId: point.id,
        customerIndex,
        amount: String(amount),
        productIds: purchase ? productIds : [],
        quantities: purchase ? quantities : [],
        purchaseNonce: purchase ? String(nonces[customerIndex]++) : null,
      });
      balances[customerIndex] += purchase ? -amount : amount;
    }
  }
  return {
    options, start, end: start + options.days * 86400 - 1,
    controls, operations, finalBalances: balances.map(String),
    semanticHash: sha256(JSON.stringify({ options, controls, operations })),
    scenarios: [
      "Aurora: peso di utilizzo crescente nel periodo simulato.",
      "Santa Rita: peso di utilizzo decrescente nel periodo simulato.",
      "San Salvario: aumento nella seconda metà del periodo simulato.",
      "Madonna di Campagna: bidone 10 temporaneamente disattivato; negozio 15 sempre attivo.",
      "I 13 quartieri senza installazioni non hanno osservazioni di utilizzo.",
    ],
  };
}
export type HistoryPlan = ReturnType<typeof historyPlan>;
export type HistoryMetrics = ReturnType<typeof aggregateFixture>["total"];

export function exposure(plan: HistoryPlan, neighborhoodId: number, from: string, to: string) {
  const points = FIXED_POINTS.filter(p => p.neighborhoodId === neighborhoodId);
  const machineDays = { installed: points.filter(p => p.kind === 0).length, activeDays: 0 };
  const storeDays = { installed: points.filter(p => p.kind === 1).length, activeDays: 0 };
  for (let day = 0; day < plan.options.days; day++) {
    const date = dayString(plan.start + day * 86400);
    if (date < from || date > to) continue;
    for (const p of points) {
      const changes = plan.controls.filter(c => c.pointId === p.id && c.day <= day);
      if (changes.at(-1)?.active === false) continue;
      (p.kind === 0 ? machineDays : storeDays).activeDays++;
    }
  }
  return { machines: machineDays.installed, stores: storeDays.installed,
    activeMachineDays: machineDays.activeDays, activeStoreDays: storeDays.activeDays };
}
const changePct = (before: string, after: string) =>
  BigInt(before) === 0n ? null : Math.round((Number(after) / Number(before) - 1) * 10000) / 100;

export function historyKnowledge(events: PlannerEvent[], plan: HistoryPlan) {
  const from = dayString(plan.start), to = dayString(plan.end);
  const totals = aggregateFixture(events);
  const months = [...new Set(events.map(e => e.timestamp.slice(0, 7)))].sort();
  const monthly = months.map(month => ({ month,
    ...aggregateFixture(events.filter(e => e.timestamp.startsWith(month))) }));
  const periodDays = Math.min(30, Math.floor(plan.options.days / 2));
  const lastFrom = dayString(plan.end - (periodDays - 1) * 86400);
  const beforeTo = dayString(plan.end - periodDays * 86400);
  const beforeFrom = dayString(plan.end - (periodDays * 2 - 1) * 86400);
  const covered = NEIGHBORHOODS.filter(n => FIXED_POINTS.some(p => p.neighborhoodId === n.id));
  const trends = covered.map(n => {
    const inArea = events.filter(e => Number(e.args.neighborhoodId) === n.id);
    const window = (a: string, b: string) => ({ from: a, to: b,
      ...aggregateFixture(inArea.filter(e => e.timestamp.slice(0, 10) >= a && e.timestamp.slice(0, 10) <= b)).total,
      ...exposure(plan, n.id, a, b) });
    const previous = window(beforeFrom, beforeTo), latest = window(lastFrom, to);
    return { neighborhoodId: n.id, neighborhoodName: n.name, previous, latest,
      bottlesChangePct: changePct(previous.bottlesCollected, latest.bottlesCollected),
      depositOperationsChangePct: changePct(previous.depositCount, latest.depositCount),
      purchaseOperationsChangePct: changePct(previous.purchaseCount, latest.purchaseCount) };
  });
  const coverage = NEIGHBORHOODS.map(n => ({ neighborhoodId: n.id, neighborhoodName: n.name,
    ...exposure(plan, n.id, from, to),
    usageObserved: totals.byNeighborhood.some(row => row.neighborhoodId === n.id),
    coverageStatus: FIXED_POINTS.some(p => p.neighborhoodId === n.id) ? "installed" : "no_installations" }));
  const documents: {
    documentId: string; version: string; title: string; text: string; contentHash: string;
    metadata: { source: string; simulated: true; geographicUnit: string; areaId: number | null;
      from: string; to: string; sourceFiles: string[] };
  }[] = [];
  const add = (id: string, title: string, text: string, areaId: number | null, a = from, b = to) => {
    const body = `${title}\nDati SIMULATI su Hardhat locale; non descrivono comportamenti reali dei quartieri. Periodo UTC: ${a} – ${b} (estremi inclusi).\n${text}`;
    documents.push({ documentId: `history-v1:${id}`, version: plan.semanticHash,
      title, text: body, contentHash: sha256(body),
      metadata: { source: "hardhat_local_simulation", simulated: true,
        geographicUnit: areaId === null ? "rete_demo" : "quartiere", areaId,
        from: a, to: b, sourceFiles: ["events.jsonl", "aggregates.json", "points.json"] } });
  };
  const describe = (m: HistoryMetrics) =>
    `Conferimenti: ${m.depositCount}; bottiglie raccolte: ${m.bottlesCollected}; RCS emessi: ${m.tokensMinted}. Acquisti: ${m.purchaseCount}; RCS spesi e bruciati: ${m.tokensBurned}. Wallet distinti di conferimento: ${m.distinctDepositWallets}; wallet distinti di acquisto: ${m.distinctPurchaseWallets}. I wallet distinti sono identificatori tecnici fittizi, non una misura di persone o residenti.`;
  const capacity = (e: ReturnType<typeof exposure>) =>
    `Installazioni: ${e.machines} bidoni, ${e.stores} supermercati. Esposizione: ${e.activeMachineDays} giorni-bidone attivi, ${e.activeStoreDays} giorni-negozio attivi. Le attività sono attribuite al quartiere del punto; il quartiere di residenza dei clienti è sconosciuto.`;
  add("network", "Rete dimostrativa: riepilogo complessivo", `${describe(totals.total)}\nSaldo RCS complessivo a fine periodo: ${BigInt(totals.total.tokensMinted) - BigInt(totals.total.tokensBurned)}. Ci sono 10 bidoni e 6 supermercati in 10 quartieri; 13 quartieri del catalogo non hanno installazioni. Le commissioni dei conferimenti sono pagate dalle macchinette, quelle degli acquisti dai supermercati. I clienti hanno zero ETH.`, null);
  for (const n of NEIGHBORHOODS) {
    const e = exposure(plan, n.id, from, to);
    const metrics = totals.byNeighborhood.find(row => row.neighborhoodId === n.id);
    const changes = plan.controls.filter(c => FIXED_POINTS.some(p => p.id === c.pointId && p.neighborhoodId === n.id));
    const statusNote = changes.length ? "\nCambi di stato registrati on-chain: " + changes.map(c =>
      `punto ${c.pointId} ${c.active ? "riattivato" : "disattivato"} il ${iso(c.timestamp)}`).join("; ") +
      ". I giorni di fermo sono esclusi dall'esposizione del bidone; il supermercato del quartiere resta attivo." : "";
    add(`neighborhood:${n.id}`, `${n.name} (IDQUART ${n.id}): intero periodo`,
      `${capacity(e)}\n${metrics ? describe(metrics) : "Nessun punto installato e nessuna osservazione di utilizzo. I dati di utilizzo sono assenti; non interpretare l'assenza di installazioni come domanda nulla o scarso interesse."}${statusNote}`, n.id);
  }
  for (const m of monthly) {
    const a = m.month + "-01" < from ? from : m.month + "-01";
    const monthEnd = new Date(Date.UTC(Number(m.month.slice(0, 4)), Number(m.month.slice(5)), 0)).toISOString().slice(0, 10);
    const b = monthEnd > to ? to : monthEnd;
    for (const n of covered) {
      const metrics = m.byNeighborhood.find(row => row.neighborhoodId === n.id);
      add(`neighborhood:${n.id}:month:${m.month}`, `${n.name} (IDQUART ${n.id}): ${m.month}`,
        `${capacity(exposure(plan, n.id, a, b))}\n${describe(metrics ?? aggregateFixture([]).total)}`, n.id, a, b);
    }
  }
  for (const trend of trends) {
    const pct = (value: number | null) => value === null ? "non calcolabile: periodo precedente a zero" : `${value}%`;
    add(`neighborhood:${trend.neighborhoodId}:trend`, `${trend.neighborhoodName}: confronto ultimi ${periodDays} giorni`,
      `Periodo precedente ${trend.previous.from} – ${trend.previous.to}: ${describe(trend.previous)}\n${capacity(trend.previous)}\nPeriodo recente ${trend.latest.from} – ${trend.latest.to}: ${describe(trend.latest)}\n${capacity(trend.latest)}\nVariazione delle bottiglie: ${pct(trend.bottlesChangePct)}. Variazione dei conferimenti: ${pct(trend.depositOperationsChangePct)}. Variazione degli acquisti: ${pct(trend.purchaseOperationsChangePct)}. Questi confronti misurano soltanto l'utilizzo simulato delle installazioni presenti.`, trend.neighborhoodId, beforeFrom, to);
  }
  add("methodology", "Provenienza e limiti dello storico simulato",
    "Gli eventi sono prodotti da transazioni realmente eseguite sul contratto RCS di protocollo 3 in una rete Hardhat temporanea. Bottiglie, clienti e comportamenti sono simulati. Ogni bottiglia genera 1 RCS; l'acquisto brucia RCS. Il gas è misurato in ETH locali, non in euro. Il gas payer di un acquisto è il supermercato; il cliente va identificato da PurchaseCompleted.buyer. Non sommare wallet distinti tra giorni, quartieri o mesi. Non ricostruire il saldo dei residenti sottraendo raccolta e spesa del quartiere: i wallet possono usare punti diversi. Le date sono UTC e i periodi estremi inclusi. Le variazioni percentuali hanno base nel periodo precedente; se la base è zero il dato è non calcolabile. Mancano coordinate dei punti, zona statistica, residenza dei clienti, misure di bisogno sociale e costi di installazione: dai soli eventi non si può determinare dove installare nuovi punti. Usare query sull'intero dataset per conteggi e graduatorie; il recupero di pochi documenti vettoriali non calcola i totali. Le schede sono pronte per l'ingestione; l'indice QVAC e la chat non sono inclusi in questo export.", null);
  const questions: { id: string; question: string; expected: unknown; documentIds: string[] }[] = [];
  const qa = (question: string, expected: unknown, ids: string[]) => questions.push({
    id: `Q${String(questions.length + 1).padStart(2, "0")}`, question, expected,
    documentIds: ids.map(id => `history-v1:${id}`),
  });
  qa("Quante operazioni ci sono nello storico?", { operations: events.length }, ["network"]);
  qa("Quante bottiglie sono state raccolte?", { bottles: totals.total.bottlesCollected }, ["network"]);
  qa("Quanti RCS sono stati emessi?", { tokensMinted: totals.total.tokensMinted }, ["network"]);
  qa("Quanti acquisti sono stati completati?", { purchases: totals.total.purchaseCount }, ["network"]);
  qa("Quanti RCS sono stati spesi?", { tokensBurned: totals.total.tokensBurned }, ["network"]);
  qa("Qual è l'offerta RCS alla fine del periodo?", { supply: String(BigInt(totals.total.tokensMinted) - BigInt(totals.total.tokensBurned)) }, ["network"]);
  qa("Quanti wallet distinti hanno conferito bottiglie?", { wallets: totals.total.distinctDepositWallets }, ["network"]);
  qa("Quanti wallet distinti hanno effettuato acquisti?", { wallets: totals.total.distinctPurchaseWallets }, ["network"]);
  for (const id of [7, 11, 2]) {
    qa(`Quali sono i totali di ${NEIGHBORHOODS.find(n => n.id === id)!.name}?`, totals.byNeighborhood.find(n => n.neighborhoodId === id) ?? null, [`neighborhood:${id}`]);
    qa(`Come varia l'utilizzo di ${NEIGHBORHOODS.find(n => n.id === id)!.name} negli ultimi ${periodDays} giorni?`, trends.find(t => t.neighborhoodId === id), [`neighborhood:${id}:trend`]);
  }
  qa("Il bidone di Madonna di Campagna è sempre rimasto attivo?", { ...exposure(plan, 16, from, to), controls: plan.controls.map(c => ({ pointId: c.pointId, active: c.active, timestamp: iso(c.timestamp) })) }, ["neighborhood:16"]);
  qa("Quanti quartieri non hanno installazioni?", { count: coverage.filter(c => c.coverageStatus === "no_installations").length }, ["network"]);
  qa("L'assenza di operazioni a Crocetta dimostra che non c'è domanda?", { answer: "No: non ci sono installazioni, la domanda non è misurata." }, ["neighborhood:3", "methodology"]);
  qa("Chi paga il gas dell'acquisto?", { payer: "supermercato", customerEth: "0" }, ["network", "methodology"]);
  qa("Si possono sommare i wallet distinti dei singoli mesi?", { answer: "No, occorre deduplicare i wallet nell'intero intervallo." }, ["methodology"]);
  qa("Quali sono i quartieri più bisognosi e le coordinate per installare nuovi bidoni?", { answer: "Non determinabile dai soli eventi: mancano indicatori sociali e coordinate dei punti." }, ["methodology"]);
  return { totals, monthly, trends, coverage, documents, questions };
}

export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return keys.map(cell).join(",") + "\n" + rows.map(row => keys.map(k => cell(row[k])).join(",")).join("\n") + "\n";
}
