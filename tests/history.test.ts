import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeEventLog } from "viem";
import { FIXED_POINTS, json } from "@riciclo/shared";
import { tokenAbi } from "@riciclo/shared/abi";
import { HISTORY_DEFAULTS, historyPlan, sha256 } from "../scripts/history-data.js";
import { simulateHistory } from "../scripts/simulate-history.js";
import { aggregateFixture, type PlannerEvent } from "../scripts/planner-fixtures.js";

test("seed fisso: 5.000 operazioni valide, saldi coerenti e tutti i punti fissi", () => {
  const plan = historyPlan(HISTORY_DEFAULTS);
  assert.equal(plan.semanticHash, historyPlan({ ...HISTORY_DEFAULTS }).semanticHash);
  assert.notEqual(plan.semanticHash, historyPlan({ ...HISTORY_DEFAULTS, seed: 23 }).semanticHash);
  assert.equal(plan.operations.length, 5000);
  assert.equal(new Set(plan.operations.map(op => op.pointId)).size, 16);
  assert.equal(new Set(plan.operations.map(op => op.day)).size, 180);
  const balances = Array<bigint>(120).fill(0n);
  const nonces = Array<bigint>(120).fill(0n);
  let previousTimestamp = plan.start;
  for (const op of plan.operations) {
    assert.ok(op.timestamp > previousTimestamp && op.timestamp <= plan.end);
    previousTimestamp = op.timestamp;
    const point = FIXED_POINTS.find(p => p.id === op.pointId)!;
    assert.equal(point.kind, op.kind === "deposit" ? 0 : 1);
    const active = plan.controls.filter(c => c.pointId === point.id && c.timestamp <= op.timestamp).at(-1)?.active ?? true;
    assert.ok(active, "Mai usare un punto disattivato");
    if (op.kind === "deposit") {
      assert.ok(BigInt(op.amount) >= 1n && BigInt(op.amount) <= 100n);
      balances[op.customerIndex] += BigInt(op.amount);
    } else {
      assert.equal(op.purchaseNonce, String(nonces[op.customerIndex]++));
      const prices: Record<string, bigint> = { "1": 1n, "2": 2n, "3": 4n, "4": 3n };
      const cost = op.productIds.reduce((s, id, i) => s + prices[id] * BigInt(op.quantities[i]), 0n);
      assert.equal(cost, BigInt(op.amount));
      balances[op.customerIndex] -= cost;
      assert.ok(balances[op.customerIndex] >= 0n);
    }
  }
  assert.deepEqual(balances.map(String), plan.finalBalances);
});

test("parametri non validi rifiutati prima di avviare una rete", () => {
  for (const invalid of [{ seed: -1 }, { start: "2026-02-30" }, { start: "no" },
    { days: 0 }, { customers: 0 }, { operations: 20 }, { operations: 1.5 }])
    assert.throws(() => historyPlan({ ...HISTORY_DEFAULTS, ...invalid }));
});

test("export Hardhat riconciliabile dai log, schede RAG senza wallet e output protetto", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "riciclo-history-test-"));
  const output = join(root, "dataset");
  const options = { ...HISTORY_DEFAULTS, days: 12, operations: 120, customers: 8 };
  try {
    const manifest = await simulateHistory(options, output, 18551, () => {});
    assert.equal(manifest.counts.operationalTransactions, 120);
    assert.equal(manifest.counts.setupTransactions, 5);
    assert.equal(manifest.counts.statusTransactions, 2);
    assert.equal(manifest.counts.evaluationQuestions, 20);
    const parse = (file: string) => JSON.parse(readFileSync(join(output, file), "utf8"));
    const lines = (file: string) => readFileSync(join(output, file), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const events: PlannerEvent[] = lines("events.jsonl");
    const transactions = lines("transactions.jsonl");
    assert.equal(transactions.length, 127);
    const rawOperational = transactions.flatMap(tx => tx.receipt.logs.flatMap((log: any) => {
      try {
        const decoded = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BottlesDeposited" && decoded.eventName !== "PurchaseCompleted") return [];
        const args = JSON.parse(json(decoded.args));
        if (decoded.eventName === "PurchaseCompleted")
          assert.notEqual(args.buyer.toLowerCase(), tx.receipt.from.toLowerCase());
        return [{ eventName: decoded.eventName, transactionHash: tx.receipt.transactionHash, args }];
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        return [];
      }
    }));
    assert.equal(rawOperational.length, 120);
    assert.deepEqual(rawOperational, events.map(e => ({ eventName: e.eventName, transactionHash: e.transactionHash, args: e.args })));
    const expected = aggregateFixture(events), aggregates = parse("aggregates.json");
    for (const key of ["total", "byDayNeighborhood", "byNeighborhood", "byPoint"] as const)
      assert.deepEqual(aggregates[key], expected[key]);
    assert.equal(aggregates.coverage.filter((c: any) => c.coverageStatus === "no_installations").length, 13);
    assert.equal(aggregates.coverage.find((c: any) => c.neighborhoodId === 16).activeMachineDays, 10);
    const finalBalances = parse("wallets.json");
    assert.ok(finalBalances.every((w: any) => w.balanceEthWei === "0"));
    assert.equal(finalBalances.reduce((s: bigint, w: any) => s + BigInt(w.balanceRcs), 0n), BigInt(manifest.finalSupplyRcs));
    const docs = lines("rag-documents.jsonl");
    assert.equal(docs.length, manifest.counts.ragDocuments);
    assert.equal(new Set(docs.map(d => d.documentId)).size, docs.length);
    const statusDocument = docs.find(d => d.documentId === "history-v1:neighborhood:16");
    for (const control of historyPlan(options).controls)
      assert.ok(statusDocument.text.includes(new Date(control.timestamp * 1000).toISOString()));
    assert.ok(!/0x[0-9a-fA-F]{40}/.test(readFileSync(join(output, "rag-documents.jsonl"), "utf8")));
    for (const doc of docs) {
      assert.equal(doc.contentHash, sha256(doc.text));
      assert.equal(doc.metadata.simulated, true);
      assert.ok(doc.text.includes("SIMULATI"));
      assert.ok(doc.metadata.from <= doc.metadata.to);
    }
    for (const question of parse("evaluation-questions.json"))
      for (const id of question.documentIds) assert.ok(docs.some(d => d.documentId === id));
    for (const [file, checksum] of Object.entries(manifest.checksums))
      assert.equal(sha256(readFileSync(join(output, file))), checksum);
    assert.equal(Object.keys(manifest.checksums).length, readdirSync(output).length - 1);
    await assert.rejects(simulateHistory(options, output, 18551, () => {}), /esiste già/);
    await assert.rejects(simulateHistory(options, join(root, "other"), 8545, () => {}), /isolata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
