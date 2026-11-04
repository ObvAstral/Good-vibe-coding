import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChain } from "../../scripts/local-chain.js";
import { deployDemo } from "../../scripts/deploy.js";
import { TerminalService, type ServiceOptions } from "../src/service.js";
import { createApp } from "../src/app.js";
import { localAccount, localOperators } from "@riciclo/shared/local";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  getAddress,
  recoverTypedDataAddress,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import {
  cartHash,
  FIXED_POINTS,
  purchaseDomain,
  purchaseTypes,
  buyerAuthorization,
  purchaseArgs,
} from "@riciclo/shared";
let chain: Awaited<ReturnType<typeof startChain>>, options: ServiceOptions;
let directory: string;
before(async () => {
  chain = await startChain(18545);
  const deployment = await deployDemo(chain.rpcUrl);
  directory = mkdtempSync(join(tmpdir(), "riciclo-backend-"));
  options = {
    deployment,
    rpcUrl: chain.rpcUrl,
    publicRpcUrl: chain.rpcUrl,
    databasePath: join(directory, "state.sqlite"),
    operators: localOperators(),
  };
});
after(async () => {
  if (chain) await chain.stop();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
const input = () => ({
  recipient: localAccount(5).address,
  machineId: "1",
  bottles: 10,
  requestId: randomUUID(),
});
it("idempotenza concorrente, payload in conflitto e recupero dopo riavvio", async () => {
  let service = new TerminalService(options);
  await service.validateDeployment();
  let app = createApp(service);
  const body = input();
  const replies = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({ method: "POST", url: "/api/deposits", payload: body }),
    ),
  );
  const hashes = replies.map((r) => r.json().txHash);
  assert(hashes[0]);
  assert.equal(new Set(hashes).size, 1);
  for (const r of replies) assert([200, 202].includes(r.statusCode));
  const conflict = await app.inject({
    method: "POST",
    url: "/api/deposits",
    payload: { ...body, bottles: 11 },
  });
  assert.equal(conflict.statusCode, 409);
  await chain.client.waitForTransactionReceipt({ hash: hashes[0] });
  await app.close();
  await service.close();
  service = new TerminalService(options);
  app = createApp(service);
  await service.recover();
  const recovered = await app.inject({
    method: "POST",
    url: "/api/deposits",
    payload: body,
  });
  assert.equal(recovered.json().txHash, hashes[0]);
  assert.equal(recovered.json().status, "confirmed");
  const logs = await chain.client.getContractEvents({
    address: options.deployment.contractAddress,
    abi: tokenAbi,
    eventName: "BottlesDeposited",
    fromBlock: BigInt(options.deployment.deploymentBlock),
    toBlock: "latest",
  });
  assert.equal(
    logs.filter((log) => log.transactionHash === hashes[0]).length,
    1,
  );
  await app.close();
  await service.close();
});
it("broadcast ambiguo: conserva bytes e hash prima di inviare", async () => {
  let service = new TerminalService({
    ...options,
    databasePath: join(directory, "ambiguous.sqlite"),
  });
  const original = service.client.sendRawTransaction;
  service.client.sendRawTransaction = async (args) => {
    await original(args);
    throw new Error("RPC timeout dopo il broadcast");
  };
  const body = input(),
    result = await service.deposit(body);
  assert(result.txHash);
  assert.equal(result.status, "prepared");
  const row = service.db
    .prepare("SELECT raw_tx,tx_nonce FROM deposits WHERE request_id=?")
    .get(body.requestId) as { raw_tx: string; tx_nonce: number };
  assert(row.raw_tx);
  await service.close();
  service = new TerminalService({
    ...options,
    databasePath: join(directory, "ambiguous.sqlite"),
  });
  await service.recover();
  const recovered = await service.deposit(body);
  assert.equal(recovered.txHash, result.txHash);
  assert.equal(recovered.status, "confirmed");
  const after = service.db
    .prepare("SELECT raw_tx,tx_nonce FROM deposits WHERE request_id=?")
    .get(body.requestId);
  assert.deepEqual(after, row);
  await service.close();
});
it("errori RPC prima della firma: stessa richiesta recuperabile", async () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "rpc.sqlite"),
  });
  const original = service.client.readContract;
  service.client.readContract = async () => {
    throw new Error("RPC down");
  };
  const body = input();
  const pending = await service.deposit(body);
  assert.equal(pending.status, "prepared");
  assert.equal(pending.txHash, null);
  service.client.readContract = original;
  await service.recover();
  const result = await service.deposit(body);
  assert(result.txHash);
  await chain.client.waitForTransactionReceipt({ hash: result.txHash });
  await service.recover();
  assert.equal((await service.deposit(body)).status, "confirmed");
  await service.close();
});
it("schema, indirizzi, quantità, ID e punti errati vengono rifiutati", async () => {
  const service = new TerminalService({ ...options, databasePath: ":memory:" }),
    app = createApp(service);
  for (const invalid of [
    { bottles: 0 },
    { bottles: 101 },
    { bottles: 1.5 },
    { bottles: "10" },
    { machineId: "0" },
    { machineId: "9".repeat(78) },
    { recipient: "0x123" },
    { requestId: "no" },
    { unexpected: true },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/deposits",
          payload: { ...input(), ...invalid },
        })
      ).statusCode,
      400,
    );
  const badPoint = await app.inject({
    method: "POST",
    url: "/api/deposits",
    payload: { ...input(), machineId: "3" },
  });
  assert.equal(badPoint.statusCode, 422);
  const missing = await app.inject({ url: `/api/deposits/${randomUUID()}` });
  assert.equal(missing.statusCode, 404);
  const config = (await app.inject({ url: "/api/config" })).json();
  assert.equal(config.points.length, 16);
  assert.equal(config.points.filter((p: any) => p.kind === 0).length, 10);
  assert.equal(config.points.filter((p: any) => p.kind === 1).length, 6);
  assert.equal(config.points.find((p: any) => p.id === "2").neighborhoodId, 11);
  assert.equal(
    config.points.find((p: any) => p.id === "2").neighborhoodName,
    "Santa Rita",
  );
  assert.equal(config.deployment.neighborhoods.length, 23);
  assert(!JSON.stringify(config).includes("privateKey"));
  await app.close();
  await service.close();
});
it("preventivo ordinato, firma EIP-712 corretta e carrelli invalidi", async () => {
  const service = new TerminalService({ ...options, databasePath: ":memory:" }),
    app = createApp(service);
  const body = {
    buyer: localAccount(5).address,
    storeId: "4",
    cart: [
      { productId: "4", quantity: 1 },
      { productId: "2", quantity: 1 },
    ],
  };
  const beforeTime = BigInt(Math.floor(Date.now() / 1000));
  const blockTime = (await chain.client.getBlock()).timestamp;
  const response = await app.inject({
    method: "POST",
    url: "/api/purchase-quotes",
    payload: body,
  });
  assert.equal(response.statusCode, 200);
  const q = response.json();
  assert.deepEqual(q.productIds, ["2", "4"]);
  assert.equal(q.maxTotal, "5");
  const signer = await recoverTypedDataAddress({
    domain: purchaseDomain(31337, options.deployment.contractAddress),
    types: purchaseTypes,
    primaryType: "Purchase",
    message: {
      buyer: q.buyer,
      storeId: 4n,
      cartHash: cartHash([2n, 4n], [1n, 1n]),
      maxTotal: 5n,
      nonce: BigInt(q.nonce),
      deadline: BigInt(q.deadline),
    },
    signature: q.signature,
  });
  assert.equal(getAddress(signer), localAccount(4).address);
  const afterTime = BigInt(Math.floor(Date.now() / 1000));
  assert(
    BigInt(q.deadline) >=
      (blockTime > beforeTime ? blockTime : beforeTime) + 300n,
  );
  assert(
    BigInt(q.deadline) <=
      (blockTime > afterTime ? blockTime : afterTime) + 300n,
  );
  for (const cart of [
    [],
    [{ productId: "2", quantity: 0 }],
    [
      { productId: "2", quantity: 1 },
      { productId: "2", quantity: 1 },
    ],
    [{ productId: "99", quantity: 1 }],
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/purchase-quotes",
          payload: { ...body, cart },
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/purchase-quotes",
        payload: { ...body, storeId: "1" },
      })
    ).statusCode,
    422,
  );
  await app.close();
  await service.close();
});
it("database non riutilizzabile con un deployment differente", () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "guard.sqlite"),
  });
  assert.throws(
    () =>
      new TerminalService({
        ...options,
        databasePath: join(directory, "guard.sqlite"),
        deployment: {
          ...options.deployment,
          contractAddress: localAccount(0).address,
        },
      }),
    /altro deployment/,
  );
  return service.close();
});

it("richieste distinte concorrenti riservano nonce di transazione differenti", async () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "concurrent.sqlite"),
  });
  const buyer = localAccount(5).address;
  const contract = {
    address: options.deployment.contractAddress,
    abi: tokenAbi,
  };
  const before = await chain.client.readContract({
    ...contract,
    functionName: "balanceOf",
    args: [buyer],
  });
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      service.deposit({ ...input(), bottles: 1 }),
    ),
  );
  assert.equal(new Set(results.map((result) => result.txHash)).size, 4);
  for (const result of results) {
    assert(result.txHash);
    await chain.client.waitForTransactionReceipt({ hash: result.txHash });
  }
  const rows = service.db.prepare("SELECT tx_nonce FROM deposits").all() as {
    tx_nonce: number;
  }[];
  assert.equal(new Set(rows.map((row) => row.tx_nonce)).size, 4);
  assert.equal(
    await chain.client.readContract({
      ...contract,
      functionName: "balanceOf",
      args: [buyer],
    }),
    before + 4n,
  );
  await service.close();
});
it("riavvio prima del broadcast: invia esattamente la transazione già salvata", async () => {
  const databasePath = join(directory, "before-broadcast.sqlite");
  let service = new TerminalService({ ...options, databasePath });
  service.client.sendRawTransaction = async () => {
    throw new Error("RPC non raggiungibile prima del broadcast");
  };
  const body = input(),
    prepared = await service.deposit(body);
  assert(prepared.txHash);
  assert.equal(prepared.status, "prepared");
  const raw = service.db
    .prepare("SELECT raw_tx FROM deposits WHERE request_id=?")
    .get(body.requestId);
  await service.close();
  service = new TerminalService({ ...options, databasePath });
  await service.recover();
  const sent = await service.deposit(body);
  assert.equal(sent.txHash, prepared.txHash);
  await chain.client.waitForTransactionReceipt({ hash: sent.txHash! });
  await service.recover();
  assert.equal((await service.deposit(body)).status, "confirmed");
  assert.deepEqual(
    service.db
      .prepare("SELECT raw_tx FROM deposits WHERE request_id=?")
      .get(body.requestId),
    raw,
  );
  await service.close();
});

it("preventivo nuovo valido anche se Hardhat non ha minato per oltre cinque minuti", async (t) => {
  const service = new TerminalService({ ...options, databasePath: ":memory:" });
  const block = await chain.client.getBlock();
  const wallTime = block.timestamp + 600n;
  t.mock.method(Date, "now", () => Number(wallTime) * 1000);
  try {
    const quote = await service.quote(localAccount(5).address, "4", [
      { productId: "1", quantity: 1 },
    ]);
    assert.equal(BigInt(quote.deadline), wallTime + 300n);
    assert(BigInt(quote.deadline) > BigInt(Math.floor(Date.now() / 1000)));
    await chain.client.simulateContract({
      address: options.deployment.contractAddress,
      abi: tokenAbi,
      account: localAccount(4),
      functionName: "purchase",
      args: purchaseArgs(
        quote,
        await localAccount(5).signTypedData(
          buyerAuthorization(quote, options.deployment),
        ),
      ),
    });
  } finally {
    t.mock.restoreAll();
    await service.close();
  }
});

async function authorizedPurchase(service: TerminalService, index = 12) {
  const buyer = localAccount(index);
  const mint = await service.deposit({
    ...input(),
    recipient: buyer.address,
    bottles: 10,
  });
  await chain.client.waitForTransactionReceipt({ hash: mint.txHash! });
  const quote = await service.quote(buyer.address, "4", [
    { productId: "2", quantity: 1 },
    { productId: "4", quantity: 1 },
  ]);
  const buyerSignature = await buyer.signTypedData(
    buyerAuthorization(quote, options.deployment),
  );
  return { quote, buyerSignature };
}
it("acquisti concorrenti idempotenti: una sola transazione e gas del negozio", async () => {
  const databasePath = join(directory, "purchases.sqlite");
  let service = new TerminalService({ ...options, databasePath });
  let app = createApp(service);
  const body = await authorizedPurchase(service);
  await createTestClient({
    mode: "hardhat",
    transport: http(chain.rpcUrl),
  }).setBalance({ address: body.quote.buyer, value: 0n });
  const before = await chain.client.getBalance({
    address: localAccount(4).address,
  });
  const replies = await Promise.all(
    Array.from({ length: 4 }, () =>
      app.inject({ method: "POST", url: "/api/purchases", payload: body }),
    ),
  );
  for (const response of replies)
    assert([200, 202].includes(response.statusCode), response.body);
  const hashes = replies.map((response) => response.json().txHash);
  assert(hashes[0]);
  assert.equal(new Set(hashes).size, 1);
  const receipt = await chain.client.waitForTransactionReceipt({
    hash: hashes[0],
  });
  assert.equal(
    before -
      (await chain.client.getBalance({ address: localAccount(4).address })),
    receipt.gasUsed * receipt.effectiveGasPrice,
  );
  assert.equal(
    await chain.client.getBalance({ address: body.quote.buyer }),
    0n,
  );
  await app.close();
  await service.close();
  service = new TerminalService({ ...options, databasePath });
  app = createApp(service);
  const replay = await app.inject({
    method: "POST",
    url: "/api/purchases",
    payload: body,
  });
  assert.equal(replay.json().status, "confirmed");
  assert.equal(replay.json().txHash, hashes[0]);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/purchases",
    payload: { ...body, quote: { ...body.quote, maxTotal: "6" } },
  });
  assert.equal(conflict.statusCode, 409);
  const status = await app.inject({
    url: `/api/purchases/${body.quote.buyer}/${body.quote.nonce}`,
  });
  assert.equal(status.json().status, "confirmed");
  assert.equal(
    (
      service.db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as {
        n: number;
      }
    ).n,
    1,
  );
  await app.close();
  await service.close();
});
it("nessuna spesa del negozio con firma buyer mancante, falsa o carrello alterato", async () => {
  const service = new TerminalService({
      ...options,
      databasePath: join(directory, "purchase-signatures.sqlite"),
    }),
    app = createApp(service);
  const body = await authorizedPurchase(service, 7);
  const store = localAccount(4).address;
  const before = await chain.client.getTransactionCount({ address: store });
  const forged = await localAccount(8).signTypedData(
    buyerAuthorization(body.quote, options.deployment),
  );
  for (const payload of [
    { quote: body.quote },
    { ...body, buyerSignature: "0x" },
    { ...body, buyerSignature: forged },
    { ...body, quote: { ...body.quote, maxTotal: "1" } },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/purchases",
      payload,
    });
    assert([400, 422].includes(response.statusCode), response.body);
  }
  assert.equal(
    (
      service.db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as {
        n: number;
      }
    ).n,
    0,
  );
  assert.equal(
    await chain.client.getTransactionCount({ address: store }),
    before,
  );
  await app.close();
  await service.close();
});
it("acquisto recuperato dopo un timeout successivo al broadcast senza secondo burn", async () => {
  const databasePath = join(directory, "purchase-timeout.sqlite");
  let service = new TerminalService({ ...options, databasePath });
  const body = await authorizedPurchase(service, 8);
  const original = service.client.sendRawTransaction;
  service.client.sendRawTransaction = async (args) => {
    await original(args);
    throw new Error("RPC timeout");
  };
  const first = await service.purchase(body);
  assert(first.txHash);
  assert.equal(first.status, "prepared");
  const saved = service.db
    .prepare("SELECT raw_tx,tx_nonce FROM purchases")
    .get();
  await service.close();
  service = new TerminalService({ ...options, databasePath });
  await service.recover();
  const recovered = await service.purchase(body);
  assert.equal(recovered.status, "confirmed");
  assert.equal(recovered.txHash, first.txHash);
  assert.deepEqual(
    service.db.prepare("SELECT raw_tx,tx_nonce FROM purchases").get(),
    saved,
  );
  assert.equal(
    await chain.client.readContract({
      address: options.deployment.contractAddress,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [body.quote.buyer],
    }),
    5n,
  );
  await service.close();
});
it("negozio senza ETH: acquisto in attesa recuperabile dopo il finanziamento", async () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "store-gas.sqlite"),
  });
  const body = await authorizedPurchase(service, 9);
  const client = createTestClient({
      mode: "hardhat",
      transport: http(chain.rpcUrl),
    }),
    store = localAccount(4).address;
  const balance = await chain.client.getBalance({ address: store });
  try {
    await client.setBalance({ address: store, value: 0n });
    const pending = await service.purchase(body);
    assert.equal(pending.status, "prepared");
    assert.equal(
      await chain.client.readContract({
        address: options.deployment.contractAddress,
        abi: tokenAbi,
        functionName: "usedPurchaseNonces",
        args: [body.quote.buyer, BigInt(body.quote.nonce)],
      }),
      false,
    );
    await client.setBalance({ address: store, value: balance });
    await service.recover();
    const sent = await service.purchase(body);
    assert(sent.txHash);
    await chain.client.waitForTransactionReceipt({ hash: sent.txHash });
    await service.recover();
    assert.equal((await service.purchase(body)).status, "confirmed");
  } finally {
    await client.setBalance({ address: store, value: balance });
    await service.close();
  }
});

it("depositi e acquisti condividono le prenotazioni dei nonce dello stesso operatore", async () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "shared-operator.sqlite"),
  });
  const body = await authorizedPurchase(service, 10),
    store = localAccount(4),
    admin = createWalletClient({
      account: localAccount(0),
      chain: service.chain,
      transport: http(chain.rpcUrl),
    });
  const point = async (operator: `0x${string}`) => {
    const hash = await admin.writeContract({
      address: options.deployment.contractAddress,
      abi: tokenAbi,
      functionName: "setPointOperator",
      args: [1n, operator],
    });
    await chain.client.waitForTransactionReceipt({ hash });
  };
  await point(store.address);
  const original = service.client.getTransactionCount;
  try {
    const firstNonce = await chain.client.getTransactionCount({
      address: store.address,
      blockTag: "pending",
    });
    const first = await service.purchase(body);
    assert(first.txHash);
    await chain.client.waitForTransactionReceipt({ hash: first.txHash });
    // An RPC may lag behind the just-mined transaction. The durable reservation wins.
    service.client.getTransactionCount = async () => firstNonce;
    const second = await service.deposit({ ...input(), bottles: 1 });
    assert(second.txHash);
    await chain.client.waitForTransactionReceipt({ hash: second.txHash });
    const purchase = service.db
      .prepare("SELECT tx_nonce FROM purchases")
      .get() as { tx_nonce: number };
    const deposit = service.db
      .prepare("SELECT tx_nonce FROM deposits ORDER BY rowid DESC LIMIT 1")
      .get() as { tx_nonce: number };
    assert.equal(purchase.tx_nonce, firstNonce);
    assert.equal(deposit.tx_nonce, firstNonce + 1);
  } finally {
    service.client.getTransactionCount = original;
    await point(localAccount(1).address);
    await service.close();
  }
});

it("tutti i 10 bidoni e 6 negozi sono operativi e mantengono il quartiere negli eventi", async () => {
  const service = new TerminalService({
    ...options,
    databasePath: join(directory, "all-points.sqlite"),
  });
  await service.validateDeployment();
  const buyer = localAccount(14);
  await createTestClient({
    mode: "hardhat",
    transport: http(chain.rpcUrl),
  }).setBalance({ address: buyer.address, value: 0n });
  const contract = {
    address: options.deployment.contractAddress,
    abi: tokenAbi,
  };
  try {
    for (const point of FIXED_POINTS.filter((p) => p.kind === 0)) {
      const sent = await service.deposit({
        ...input(),
        recipient: buyer.address,
        machineId: point.id,
        bottles: 1,
      });
      assert.equal(sent.status, "pending", sent.error);
      assert(sent.txHash);
      const receipt = await chain.client.waitForTransactionReceipt({
        hash: sent.txHash,
        timeout: 10000,
      });
      assert.equal(receipt.status, "success");
      const logs = await chain.client.getContractEvents({
        ...contract,
        eventName: "BottlesDeposited",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      assert.equal(
        logs.find((log) => log.transactionHash === sent.txHash)?.args
          .neighborhoodId,
        point.neighborhoodId,
      );
    }
    for (const point of FIXED_POINTS.filter((p) => p.kind === 1)) {
      const quote = await service.quote(buyer.address, point.id, [
        { productId: "1", quantity: 1 },
      ]);
      const buyerSignature = await buyer.signTypedData(
        buyerAuthorization(quote, options.deployment),
      );
      const sent = await service.purchase({ quote, buyerSignature });
      assert.equal(sent.status, "pending", sent.error);
      assert(sent.txHash);
      const receipt = await chain.client.waitForTransactionReceipt({
        hash: sent.txHash,
        timeout: 10000,
      });
      assert.equal(receipt.status, "success");
      const op = await chain.client.readContract({
        ...contract,
        functionName: "getPoint",
        args: [BigInt(point.id)],
      });
      assert.equal(
        (
          await chain.client.getTransaction({ hash: sent.txHash })
        ).from.toLowerCase(),
        op.operator.toLowerCase(),
      );
      const logs = await chain.client.getContractEvents({
        ...contract,
        eventName: "PurchaseCompleted",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      assert.equal(
        logs.find((log) => log.transactionHash === sent.txHash)?.args
          .neighborhoodId,
        point.neighborhoodId,
      );
    }
    assert.equal(await chain.client.getBalance({ address: buyer.address }), 0n);
    assert.equal(
      await chain.client.readContract({
        ...contract,
        functionName: "balanceOf",
        args: [buyer.address],
      }),
      4n,
    );
  } finally {
    await service.close();
  }
});
