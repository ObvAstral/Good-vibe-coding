import { it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { localAccount, assertLocal } from "@riciclo/shared/local";
import { tokenAbi } from "@riciclo/shared/abi";
import { purchaseArgs, type Quote } from "@riciclo/shared";
import { TerminalService } from "../server/src/service.js";
import { createApp } from "../server/src/app.js";
import { startChain } from "../scripts/local-chain.js";
import { deployDemo } from "../scripts/deploy.js";
import {
  aggregateFixture,
  plannerEvents,
  type PlannerEvent,
} from "../scripts/planner-fixtures.js";
it("bottiglie → API → crediti → preventivo → acquisto → eventi planner", async () => {
  const chain = await startChain(18546);
  let service: TerminalService | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const deployment = await deployDemo(chain.rpcUrl),
      buyer = localAccount(5);
    service = new TerminalService({
      deployment,
      rpcUrl: chain.rpcUrl,
      publicRpcUrl: chain.rpcUrl,
      databasePath: ":memory:",
      operators: [1, 2, 3, 4].map(localAccount),
    });
    await service.validateDeployment();
    app = createApp(service);
    const receipt = await app.inject({
      method: "POST",
      url: "/api/deposits",
      payload: {
        recipient: buyer.address,
        machineId: "1",
        bottles: 10,
        requestId: randomUUID(),
      },
    });
    assert.equal(receipt.statusCode, 202);
    await chain.client.waitForTransactionReceipt({
      hash: receipt.json().txHash,
    });
    const contract = { address: deployment.contractAddress, abi: tokenAbi };
    assert.equal(
      await chain.client.readContract({
        ...contract,
        functionName: "balanceOf",
        args: [buyer.address],
      }),
      10n,
    );
    const quoteResponse = await app.inject({
      method: "POST",
      url: "/api/purchase-quotes",
      payload: {
        buyer: buyer.address,
        storeId: "4",
        cart: [
          { productId: "2", quantity: 1 },
          { productId: "4", quantity: 1 },
        ],
      },
    });
    assert.equal(quoteResponse.statusCode, 200);
    const q = quoteResponse.json<Quote>();
    const wallet = createWalletClient({
      account: buyer,
      chain: service.chain,
      transport: http(chain.rpcUrl),
    });
    const tx = await wallet.writeContract({
      ...contract,
      functionName: "purchase",
      args: purchaseArgs(q),
    });
    assert.equal(
      (await chain.client.waitForTransactionReceipt({ hash: tx })).status,
      "success",
    );
    assert.equal(
      await chain.client.readContract({
        ...contract,
        functionName: "balanceOf",
        args: [buyer.address],
      }),
      5n,
    );
    assert.equal(
      await chain.client.readContract({
        ...contract,
        functionName: "totalSupply",
      }),
      5n,
    );
    const expensive = (
      await app.inject({
        method: "POST",
        url: "/api/purchase-quotes",
        payload: {
          buyer: buyer.address,
          storeId: "4",
          cart: [{ productId: "4", quantity: 2 }],
        },
      })
    ).json<Quote>();
    await assert.rejects(
      chain.client.simulateContract({
        ...contract,
        account: buyer,
        functionName: "purchase",
        args: purchaseArgs(expensive),
      }),
      /ERC20InsufficientBalance/,
    );
    assert.equal(
      await chain.client.readContract({
        ...contract,
        functionName: "usedPurchaseNonces",
        args: [buyer.address, BigInt(expensive.nonce)],
      }),
      false,
    );
    const events = await plannerEvents(chain.client, deployment);
    assert.equal(events.length, 2);
    const aggregate = aggregateFixture(events);
    assert.deepEqual(aggregate.total, {
      depositCount: "1",
      bottlesCollected: "10",
      tokensMinted: "10",
      purchaseCount: "1",
      tokensBurned: "5",
      distinctDepositWallets: "1",
      distinctPurchaseWallets: "1",
    });
    assert.equal(
      aggregate.byDayZone.find((row) => row.zoneId === 7)?.tokensMinted,
      "10",
    );
    assert.equal(
      aggregate.byDayZone.find((row) => row.zoneId === 2)?.tokensBurned,
      "5",
    );
    assert.deepEqual(aggregateFixture([...events, ...events]), aggregate);
  } finally {
    if (app) await app.close();
    if (service) await service.close();
    await chain.stop();
  }
});
it("fixture sintetiche: distinti ricalcolati e nessun doppio conteggio", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/planner.synthetic.json", import.meta.url),
      "utf8",
    ),
  ) as {
    events: PlannerEvent[];
    expected: ReturnType<typeof aggregateFixture>;
  };
  assert.deepEqual(aggregateFixture(fixture.events), fixture.expected);
  assert.deepEqual(
    aggregateFixture([...fixture.events, ...fixture.events]),
    fixture.expected,
  );
  assert.equal(fixture.expected.total.distinctDepositWallets, "1");
});

it("gli strumenti operativi rifiutano RPC esterni e reti diverse da Hardhat", () => {
  assert.throws(
    () => assertLocal("https://example.invalid", 31337),
    /RPC locale/,
  );
  assert.throws(() => assertLocal("http://127.0.0.1:8545", 1), /chainId 31337/);
  assert.doesNotThrow(() => assertLocal("http://127.0.0.1:18546", 31337));
});
