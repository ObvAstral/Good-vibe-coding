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
import { localAccount } from "@riciclo/shared/local";
import { tokenAbi } from "@riciclo/shared/abi";
import { getAddress, recoverTypedDataAddress } from "viem";
import { cartHash, purchaseDomain, purchaseTypes } from "@riciclo/shared";
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
    operators: [1, 2, 3, 4].map(localAccount),
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
  assert.equal(config.points.length, 4);
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
  assert.equal(
    BigInt(q.deadline) - (await chain.client.getBlock()).timestamp,
    300n,
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
