import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  createPublicClient, createWalletClient, createTestClient, defineChain,
  http, keccak256, toHex, type Hash, type TransactionReceipt,
} from "viem";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  FIXED_POINTS, json, buyerAuthorization, purchaseArgs, purchaseDomain,
  purchaseTypes, purchaseMessage, type Quote,
} from "@riciclo/shared";
import { localAccount, localOperators } from "@riciclo/shared/local";
import { projectRoot, readArtifact } from "@riciclo/shared/deployment";
import { deployDemo } from "./deploy.js";
import { startChain } from "./local-chain.js";
import { plannerEvents } from "./planner-fixtures.js";
import {
  HISTORY_DEFAULTS, HISTORY_PRODUCTS, historyPlan, historyKnowledge,
  sha256, csv, iso, dayString, type HistoryOptions,
} from "./history-data.js";

export async function simulateHistory(options: HistoryOptions, output: string, port = 18550,
  progress: (message: string) => void = console.log) {
  const plan = historyPlan(options);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8545)
    throw new Error("Usare una porta isolata tra 1024 e 65535 diversa da 8545.");
  const target = resolve(output);
  if (existsSync(target)) throw new Error(`La cartella esiste già: ${target}. Scegliere un nuovo --output.`);
  const bytecodeSha256 = sha256(Buffer.from(readArtifact().bytecode.slice(2), "hex"));
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(resolve(dirname(target), ".history-build-"));
  const network = await startChain(port, { initialDate: iso(plan.start - 60) }).catch(error => {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  });
  try {
    const test = createTestClient({ mode: "hardhat", transport: http(network.rpcUrl) });
    await test.setLoggingEnabled(false);
    const deployment = await deployDemo(network.rpcUrl);
    const chain = defineChain({ id: 31337, name: "Hardhat storico isolato",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } } });
    const client = createPublicClient({ chain, cacheTime: 0, transport: http(network.rpcUrl) });
    const operators = localOperators();
    const wallet = (account: ReturnType<typeof localAccount>) =>
      createWalletClient({ chain, account, transport: http(network.rpcUrl) });
    const wallets = operators.map(wallet), admin = wallet(localAccount(0));
    // Indices >= 20 are outside Hardhat's twenty prefunded accounts.
    const customers = Array.from({ length: options.customers }, (_, i) => localAccount(i + 20));
    for (const customer of customers)
      assert.equal(await client.getBalance({ address: customer.address }), 0n);
    const startingEth = await Promise.all(operators.map(a => client.getBalance({ address: a.address })));
    const gasByOperator = operators.map(() => 0n);
    const contract = { address: deployment.contractAddress, abi: tokenAbi };
    const products = await client.readContract({ ...contract, functionName: "getProducts" });
    assert.deepEqual(JSON.parse(json(products)), HISTORY_PRODUCTS);
    type TransactionRow = { source: "hardhat_local_simulation"; simulated: true;
      kind: string; timestamp: string; gasCostWei: string; receipt: TransactionReceipt };
    const transactions: TransactionRow[] = [];
    const record = async (hash: Hash, kind: string, timestamp?: number) => {
      const receipt = await client.getTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", `Transazione ${hash} fallita`);
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (timestamp !== undefined) assert.equal(block.timestamp, BigInt(timestamp));
      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      transactions.push({ source: "hardhat_local_simulation", simulated: true,
        kind, timestamp: iso(Number(block.timestamp)), gasCostWei: String(cost), receipt });
      const index = operators.findIndex(a => a.address.toLowerCase() === receipt.from.toLowerCase());
      if (index >= 0) gasByOperator[index] += cost;
      return receipt;
    };
    // Include deployment and product setup receipts for complete event provenance.
    for (let number = BigInt(deployment.deploymentBlock); number <= await client.getBlockNumber({ cacheTime: 0 }); number++) {
      const block = await client.getBlock({ blockNumber: number });
      for (const hash of block.transactions) await record(hash, "setup");
    }
    progress(`Rete isolata ${network.rpcUrl}; ${options.days} giorni, ${options.operations} operazioni, ${options.customers} clienti a zero ETH.`);
    const controls = [...plan.controls];
    for (const op of plan.operations) {
      while (controls.length && controls[0].timestamp < op.timestamp) {
        const change = controls.shift()!;
        await test.setNextBlockTimestamp({ timestamp: BigInt(change.timestamp) });
        await record(await admin.writeContract({ ...contract, functionName: "setPointActive",
          args: [BigInt(change.pointId), change.active], gas: 100000n }), "point_status", change.timestamp);
      }
      await test.setNextBlockTimestamp({ timestamp: BigInt(op.timestamp) });
      const point = FIXED_POINTS.find(p => p.id === op.pointId)!;
      const operator = wallets[point.operatorSlot], customer = customers[op.customerIndex];
      let hash: Hash;
      if (op.kind === "deposit") {
        hash = await operator.writeContract({ ...contract, functionName: "deposit",
          args: [BigInt(point.id), customer.address, BigInt(op.amount),
            keccak256(toHex(`${plan.semanticHash}:deposit:${op.sequence}`))], gas: 200000n });
      } else {
        // Historical quotes use simulated chain time, never the host wall clock.
        const quote: Quote = { buyer: customer.address, storeId: point.id,
          productIds: op.productIds, quantities: op.quantities, maxTotal: op.amount,
          nonce: op.purchaseNonce!, deadline: String(op.timestamp + 300), signature: "0x" };
        quote.signature = await operator.signTypedData({
          domain: purchaseDomain(31337, deployment.contractAddress), types: purchaseTypes,
          primaryType: "Purchase", message: purchaseMessage(quote) });
        const buyerSignature = await customer.signTypedData(buyerAuthorization(quote, deployment));
        hash = await operator.writeContract({ ...contract, functionName: "purchase",
          args: purchaseArgs(quote, buyerSignature), gas: 400000n });
      }
      const receipt = await record(hash, op.kind, op.timestamp);
      assert.equal(receipt.from.toLowerCase(), operators[point.operatorSlot].address.toLowerCase());
      if (op.sequence % 500 === 0 || op.sequence === options.operations)
        progress(`${op.sequence}/${options.operations} operazioni eseguite; giorno ${op.day + 1}/${options.days}.`);
    }
    assert.equal(controls.length, 0);
    await test.setNextBlockTimestamp({ timestamp: BigInt(plan.end) });
    await test.mine({ blocks: 3, interval: 1 });
    progress("Esportazione degli eventi e riconciliazione di saldi, ricevute e gas...");
    const events = (await plannerEvents(client, deployment)).map(event => ({
      ...event, source: "hardhat_local_simulation" as const, simulated: true as const,
      protocolVersion: deployment.protocolVersion,
    }));
    assert.equal(events.length, options.operations);
    const operationTransactions = transactions.filter(t => t.kind === "deposit" || t.kind === "purchase");
    assert.equal(operationTransactions.length, options.operations);
    for (let i = 0; i < events.length; i++) {
      const event = events[i], op = plan.operations[i], tx = operationTransactions[i];
      const point = FIXED_POINTS.find(p => p.id === op.pointId)!;
      assert.equal(event.transactionHash, tx.receipt.transactionHash);
      assert.equal(event.timestamp, iso(op.timestamp));
      assert.equal(Number(event.args.neighborhoodId), point.neighborhoodId);
      assert.equal(Number(event.args.zoneId), point.zoneId);
      assert.equal(String(event.args.machineId ?? event.args.storeId), point.id);
      assert.equal(String(event.args.recipient ?? event.args.buyer).toLowerCase(), customers[op.customerIndex].address.toLowerCase());
      assert.equal(String(event.args.minted ?? event.args.burned), op.amount);
      assert.equal(event.eventName, op.kind === "deposit" ? "BottlesDeposited" : "PurchaseCompleted");
    }
    const knowledge = historyKnowledge(events, plan);
    const totalSupply = await client.readContract({ ...contract, functionName: "totalSupply" });
    assert.equal(totalSupply, BigInt(knowledge.totals.total.tokensMinted) - BigInt(knowledge.totals.total.tokensBurned));
    let walletSum = 0n;
    const walletRows: { address: string; balanceRcs: string; balanceEthWei: string }[] = [];
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      const balance = await client.readContract({ ...contract, functionName: "balanceOf", args: [customer.address] });
      const eth = await client.getBalance({ address: customer.address });
      assert.equal(balance, BigInt(plan.finalBalances[i]));
      assert.equal(eth, 0n);
      walletSum += balance;
      walletRows.push({ address: customer.address, balanceRcs: String(balance), balanceEthWei: String(eth) });
    }
    assert.equal(walletSum, totalSupply);
    const operatorGas = [];
    for (let i = 0; i < operators.length; i++) {
      const after = await client.getBalance({ address: operators[i].address });
      assert.equal(startingEth[i] - after, gasByOperator[i]);
      operatorGas.push({ role: i < 2 ? "machine" : "store", operator: operators[i].address,
        gasPaidWei: String(gasByOperator[i]), initialEthWei: String(startingEth[i]), finalEthWei: String(after) });
    }
    const statusTransactions = transactions.filter(t => t.kind === "point_status");
    assert.equal(statusTransactions.length, plan.controls.length);
    const finalBlock = await client.getBlock();
    const checksums: Record<string, string> = {};
    const save = (name: string, body: string) => {
      writeFileSync(resolve(staging, name), body);
      checksums[name] = sha256(body);
    };
    const saveJson = (name: string, data: unknown) => save(name, JSON.stringify(JSON.parse(json(data)), null, 2) + "\n");
    const saveLines = (name: string, rows: unknown[]) => save(name, rows.map(json).join("\n") + "\n");
    saveJson("deployment.json", deployment);
    saveLines("events.jsonl", events);
    saveLines("transactions.jsonl", transactions);
    saveJson("wallets.json", walletRows);
    saveJson("points.json", { points: FIXED_POINTS.map(p => ({ ...p, operator: operators[p.operatorSlot].address,
      neighborhoodName: deployment.neighborhoods.find(n => n.id === p.neighborhoodId)!.name })),
      products: HISTORY_PRODUCTS, controls: plan.controls.map((c, i) => ({ pointId: c.pointId, active: c.active,
        timestamp: iso(c.timestamp), transactionHash: statusTransactions[i].receipt.transactionHash })) });
    saveJson("aggregates.json", { source: "hardhat_local_simulation", simulated: true,
      period: { from: dayString(plan.start), to: dayString(plan.end), timezone: "UTC" },
      ...knowledge.totals, monthly: knowledge.monthly, trends: knowledge.trends, coverage: knowledge.coverage });
    save("events.csv", csv(events.map(e => ({ source: e.source, simulated: e.simulated, protocolVersion: e.protocolVersion,
      eventName: e.eventName, chainId: e.chainId,
      contractAddress: e.contractAddress, transactionHash: e.transactionHash, blockNumber: e.blockNumber,
      blockHash: e.blockHash, logIndex: e.logIndex, timestamp: e.timestamp,
      pointId: e.args.machineId ?? e.args.storeId, neighborhoodId: e.args.neighborhoodId,
      neighborhoodName: e.neighborhoodName, zoneId: e.args.zoneId,
      customer: e.args.recipient ?? e.args.buyer, bottles: e.args.bottles,
      tokensMinted: e.args.minted, tokensBurned: e.args.burned,
      depositId: e.args.depositId, purchaseNonce: e.args.nonce,
      productIds: e.args.productIds ? JSON.stringify(e.args.productIds) : "",
      quantities: e.args.quantities ? JSON.stringify(e.args.quantities) : "" }))));
    save("daily-neighborhoods.csv", csv(knowledge.totals.byDayNeighborhood));
    saveLines("rag-documents.jsonl", knowledge.documents);
    save("rag-corpus.md", knowledge.documents.map(d => `## ${d.title}\n\nFonte: ${d.documentId} · versione ${d.version}\n\n${d.text}\n`).join("\n"));
    saveJson("evaluation-questions.json", knowledge.questions);
    save("README.md", `# Storico simulato Riciclo Solidale\n\nDati SIMULATI: operazioni eseguite su un contratto reale in Hardhat locale, senza attività reale di cittadini o punti fisici.\n\n- Periodo UTC: ${dayString(plan.start)} – ${dayString(plan.end)}, ${options.days} giorni.\n- Operazioni: ${events.length} (${knowledge.totals.total.depositCount} conferimenti, ${knowledge.totals.total.purchaseCount} acquisti).\n- Bottiglie / RCS emessi: ${knowledge.totals.total.bottlesCollected}; RCS bruciati: ${knowledge.totals.total.tokensBurned}; offerta finale: ${totalSupply}.\n- ${options.customers} wallet cliente fittizi, tutti a zero ETH. Gas pagato da macchinette e supermercati.\n- 10 bidoni e 6 negozi fissi in 10 quartieri; altri 13 quartieri senza installazioni.\n- Seed: ${options.seed}; hash semantico del piano: ${plan.semanticHash}.\n\n## File da usare\n\n| File | Uso |\n| --- | --- |\n| rag-documents.jsonl | Una scheda per riga: usare text per embedding, documentId/version/contentHash e metadata per provenienza e filtri. Nessun wallet nelle schede. |\n| rag-corpus.md | Lo stesso contenuto in Markdown, per lettura o import testuale. Ogni sezione è una scheda distinta. |\n| aggregates.json | Totali esatti, per giorno/quartiere/punto/mese, esposizione e confronti tra periodi. |\n| events.jsonl | Eventi operativi normalizzati di protocollo 3; ogni riga è un PlannerEvent. |\n| events.csv | Stessi eventi in forma tabellare; quantità uint256 come stringhe. |\n| daily-neighborhoods.csv | Aggregati giornalieri per quartiere, solo gruppi osservati. |\n| transactions.jsonl | Ricevute reali Hardhat, log EVM originali, gas e mittente; include anche deploy, catalogo e cambi di stato. |\n| deployment.json | ABI e identità del deployment temporaneo, separato dalla demo interattiva. |\n| points.json | Catalogo fisso, prezzi e cambi di stato verificabili dalle ricevute. |\n| wallets.json | Saldi finali dei wallet fittizi; solo per analisi strutturata, fuori dal RAG. |\n| evaluation-questions.json | ${knowledge.questions.length} domande con valori attesi e documenti di riferimento; fuori dall'indice RAG. |\n| manifest.json | Parametri, snapshot, controlli e SHA-256 di tutti gli altri file. |\n\nNon caricare tutto indiscriminatamente nell'indice vettoriale. Usare rag-documents.jsonl oppure rag-corpus.md, evitando duplicati. Conteggi e classifiche richiedono query sull'intero events.jsonl o aggregati coerenti col periodo. Non sommare wallet distinti tra gruppi. Il quartiere è quello del punto, non la residenza del cliente. Un quartiere senza punti ha utilizzo non osservabile, non domanda nulla. Non sono inclusi embedding o un indice QVAC già attivo.\n\n## Scenari fittizi\n\n${plan.scenarios.map(s => `- ${s}`).join("\n")}\n\nBidone 10 disattivato da ${iso(plan.controls[0].timestamp)} a ${iso(plan.controls[1].timestamp)} (inizio incluso, fine esclusa); il negozio resta attivo. I pesi degli scenari sono ipotesi del generatore: i confronti effettivi sono in aggregates.json. Mancano dati sociali, coordinate dei punti e costi per formulare raccomandazioni territoriali complete.\n\n## Riproduzione\n\nDalla radice: npm run simulate:history -- --seed ${options.seed} --start ${options.start} --days ${options.days} --operations ${options.operations} --customers ${options.customers} --output data/simulated/nuovo-export\n\nIl comando compila, avvia e arresta una rete propria sulla porta 18550 (modificabile con --port). Rifiuta cartelle esistenti e la porta 8545; non modifica deployments/local.json o il database della demo. Stessi parametri riproducono piano, date, quantità e saldi; hash dei blocchi/receipt e data di export possono cambiare tra esecuzioni.\n`);
    const manifest = {
      schemaVersion: "1", source: "hardhat_local_simulation", simulated: true,
      physicalDepositsSimulated: true, protocolVersion: deployment.protocolVersion,
      generatedAt: new Date().toISOString(), seed: options.seed, parameters: options,
      semanticPlanSha256: plan.semanticHash, contractBytecodeSha256: bytecodeSha256,
      chainId: deployment.chainId, contractAddress: deployment.contractAddress,
      deploymentBlock: deployment.deploymentBlock, deploymentBlockHash: deployment.deploymentBlockHash,
      indexedBlock: String(finalBlock.number), indexedBlockHash: finalBlock.hash,
      finality: "Snapshot locale isolato, due blocchi minati dopo la fine del periodo; non un indicizzatore persistente.",
      period: { from: iso(plan.start), to: iso(plan.end), timezone: "UTC" },
      counts: { operationalTransactions: events.length, setupTransactions: transactions.filter(t => t.kind === "setup").length,
        statusTransactions: statusTransactions.length, ragDocuments: knowledge.documents.length,
        evaluationQuestions: knowledge.questions.length, customerWallets: customers.length },
      total: knowledge.totals.total, finalSupplyRcs: String(totalSupply),
      verification: { receiptsSuccessful: true, normalizedEventsMatchPlan: true,
        customerBalancesMatchPlan: true, customerEthAllZero: true,
        supplyEqualsMintedMinusBurned: true, operatorEthMatchesReceiptGas: true },
      operatorGas, scenarios: plan.scenarios, checksums,
    };
    writeFileSync(resolve(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Publish a complete snapshot only after every reconciliation has succeeded.
    if (existsSync(target)) throw new Error(`Output creato nel frattempo: ${target}`);
    renameSync(staging, target);
    progress(`Dataset salvato in ${target}: ${events.length} operazioni, ${knowledge.documents.length} schede RAG.`);
    return manifest;
  } finally {
    await network.stop();
    rmSync(staging, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    seed: { type: "string" }, start: { type: "string" }, days: { type: "string" },
    operations: { type: "string" }, customers: { type: "string" },
    port: { type: "string" }, output: { type: "string" },
  } });
  const options: HistoryOptions = {
    seed: Number(values.seed ?? HISTORY_DEFAULTS.seed), start: values.start ?? HISTORY_DEFAULTS.start,
    days: Number(values.days ?? HISTORY_DEFAULTS.days), operations: Number(values.operations ?? HISTORY_DEFAULTS.operations),
    customers: Number(values.customers ?? HISTORY_DEFAULTS.customers),
  };
  await simulateHistory(options, resolve(projectRoot, values.output ?? "data/simulated/history-v1"), Number(values.port ?? 18550));
}
