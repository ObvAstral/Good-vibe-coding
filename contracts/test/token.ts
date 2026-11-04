import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, stringToHex, zeroAddress } from "viem";
import {
  cartHash,
  purchaseDomain,
  purchaseTypes,
  buyerAuthorizationTypes,
} from "@riciclo/shared";

async function fixture() {
  const { viem, networkHelpers } = await network.create();
  const [admin, machine, store, buyer, other] = await viem.getWalletClients();
  const token = await viem.deployContract("RicicloSolidale");
  await token.write.registerPoint([1n, 0, 1, machine.account.address]);
  await token.write.registerPoint([2n, 1, 2, store.account.address]);
  for (const [id, name, price] of [
    [1n, "Acqua", 1n],
    [2n, "Pane", 2n],
    [3n, "Prosciutto", 4n],
    [4n, "Tonno", 3n],
  ] as const)
    await token.write.setProduct([id, name, price]);
  const depositId = keccak256(stringToHex("deposit-1"));
  const mint = (bottles = 10n, id = depositId) =>
    token.write.deposit([1n, buyer.account.address, bottles, id], {
      account: machine.account,
    });
  const client = await viem.getPublicClient();
  async function quote(
    overrides: Record<string, any> = {},
    signer = store,
    buyerSigner = buyer,
  ) {
    const block = await client.getBlock();
    const q = {
      buyer: buyer.account.address,
      storeId: 2n,
      ids: [2n, 4n],
      quantities: [1n, 1n],
      maxTotal: 5n,
      nonce: 1n,
      deadline: block.timestamp + 300n,
      ...overrides,
    };
    const signature = await signer.signTypedData({
      domain: purchaseDomain(
        overrides.chainId ?? 31337,
        overrides.contractAddress ?? token.address,
      ),
      types: purchaseTypes,
      primaryType: "Purchase",
      message: {
        buyer: q.buyer,
        storeId: q.storeId,
        cartHash: cartHash(q.ids, q.quantities),
        maxTotal: q.maxTotal,
        nonce: q.nonce,
        deadline: q.deadline,
      },
    });
    const buyerSignature = await buyerSigner.signTypedData({
      domain: purchaseDomain(
        overrides.chainId ?? 31337,
        overrides.contractAddress ?? token.address,
      ),
      types: buyerAuthorizationTypes,
      primaryType: "PurchaseAuthorization",
      message: {
        buyer: q.buyer,
        storeId: q.storeId,
        cartHash: cartHash(q.ids, q.quantities),
        maxTotal: q.maxTotal,
        nonce: q.nonce,
        deadline: q.deadline,
      },
    });
    return [
      q.buyer,
      q.storeId,
      q.ids,
      q.quantities,
      q.maxTotal,
      q.nonce,
      q.deadline,
      signature,
      buyerSignature,
    ] as const;
  }
  return {
    token,
    admin,
    machine,
    store,
    buyer,
    other,
    mint,
    quote,
    depositId,
    client,
    networkHelpers,
  };
}
describe("RicicloSolidale", () => {
  it("10 bottiglie → 10 RCS → pane e tonno → 5 RCS e supply 5", async () => {
    const f = await fixture();
    assert.equal(await f.token.read.decimals(), 0);
    assert.equal(await f.token.read.totalSupply(), 0n);
    const mintHash = await f.mint();
    const purchaseHash = await f.token.write.purchase(await f.quote(), {
      account: f.store.account,
    });
    assert.equal(await f.token.read.balanceOf([f.buyer.account.address]), 5n);
    assert.equal(await f.token.read.totalSupply(), 5n);
    const deposits = await f.token.getEvents.BottlesDeposited(
      {},
      { fromBlock: 0n, toBlock: "latest" },
    );
    const purchases = await f.token.getEvents.PurchaseCompleted(
      {},
      { fromBlock: 0n, toBlock: "latest" },
    );
    assert.equal(deposits[0].transactionHash, mintHash);
    assert.equal(deposits[0].args.zoneId, 1);
    assert.equal(deposits[0].args.minted, 10n);
    assert.equal(purchases[0].transactionHash, purchaseHash);
    assert.equal(purchases[0].args.zoneId, 2);
    assert.equal(purchases[0].args.burned, 5n);
    assert.equal(
      await f.token.read.usedPurchaseNonces([f.buyer.account.address, 1n]),
      true,
    );
  });
  it("solo admin modifica punti e catalogo, senza privilegi impliciti di mint", async () => {
    const f = await fixture();
    await assert.rejects(
      f.token.write.registerPoint([3n, 0, 1, f.machine.account.address], {
        account: f.other.account,
      }),
      /AccessControl/,
    );
    await assert.rejects(
      f.token.write.setProduct([1n, "Acqua", 2n], { account: f.other.account }),
      /AccessControl/,
    );
    await assert.rejects(
      f.token.write.setPointActive([1n, false], { account: f.other.account }),
      /AccessControl/,
    );
    await assert.rejects(
      f.token.write.setPointOperator([1n, f.other.account.address], {
        account: f.other.account,
      }),
      /AccessControl/,
    );
    await assert.rejects(
      f.token.write.deposit([1n, f.buyer.account.address, 1n, f.depositId]),
      /UnauthorizedOperator/,
    );
    for (const args of [
      [0n, 0, 1, f.machine.account.address],
      [3n, 2, 1, f.machine.account.address],
      [3n, 0, 0, f.machine.account.address],
      [3n, 0, 9, f.machine.account.address],
      [3n, 0, 1, zeroAddress],
      [1n, 0, 1, f.machine.account.address],
    ] as const)
      await assert.rejects(f.token.write.registerPoint(args), /InvalidPoint/);
    await assert.rejects(
      f.token.write.setProduct([1n, "Acqua", 0n]),
      /InvalidProduct/,
    );
    await f.token.write.setPointActive([1n, false]);
    await assert.rejects(
      f.token.write.registerPoint([1n, 0, 8, f.other.account.address]),
      /InvalidPoint/,
    );
  });
  it("mint: permessi per punto, destinatario, limiti e ID globali", async () => {
    const f = await fixture();
    for (const n of [0n, 101n])
      await assert.rejects(f.mint(n), /InvalidQuantity/);
    await assert.rejects(
      f.token.write.deposit([1n, zeroAddress, 1n, f.depositId], {
        account: f.machine.account,
      }),
      /InvalidRecipient/,
    );
    assert.equal(await f.token.read.usedDeposits([f.depositId]), false);
    await f.mint(1n);
    await assert.rejects(f.mint(), /DepositAlreadyUsed/);
    await f.token.write.registerPoint([3n, 0, 3, f.other.account.address]);
    await assert.rejects(
      f.token.write.deposit([3n, f.buyer.account.address, 1n, f.depositId], {
        account: f.other.account,
      }),
      /DepositAlreadyUsed/,
    );
    await f.token.write.setPointOperator([1n, f.other.account.address]);
    await assert.rejects(
      f.mint(100n, keccak256(stringToHex("new"))),
      /UnauthorizedOperator/,
    );
    await f.token.write.deposit(
      [1n, f.buyer.account.address, 100n, keccak256(stringToHex("new"))],
      { account: f.other.account },
    );
    await f.token.write.setPointActive([1n, false]);
    await assert.rejects(f.mint(), /InvalidPoint/);
    await assert.rejects(
      f.token.write.deposit([2n, f.buyer.account.address, 1n, f.depositId], {
        account: f.store.account,
      }),
      /InvalidPoint/,
    );
  });
  it("transfer e transferFrom vietati anche per zero e verso se stessi", async () => {
    const f = await fixture();
    await f.mint();
    for (const n of [0n, 1n])
      await assert.rejects(
        f.token.write.transfer([f.buyer.account.address, n], {
          account: f.buyer.account,
        }),
        /TransfersDisabled/,
      );
    await f.token.write.approve([f.other.account.address, 10n], {
      account: f.buyer.account,
    });
    await assert.rejects(
      f.token.write.transferFrom(
        [f.buyer.account.address, f.other.account.address, 1n],
        { account: f.other.account },
      ),
      /TransfersDisabled/,
    );
    assert.equal(await f.token.read.totalSupply(), 10n);
  });
  it("rifiuta carrelli invalidi e mantiene stato su revert", async () => {
    const f = await fixture();
    await f.mint();
    for (const [ids, quantities] of [
      [[], []],
      [[1n], [1n, 1n]],
      [
        [1n, 2n, 3n, 4n, 5n],
        [1n, 1n, 1n, 1n, 1n],
      ],
      [
        [2n, 2n],
        [1n, 1n],
      ],
      [
        [4n, 2n],
        [1n, 1n],
      ],
      [[9n], [1n]],
      [[1n], [0n]],
      [[1n], [101n]],
    ] as const) {
      await assert.rejects(
        f.token.write.purchase(await f.quote({ ids, quantities }), {
          account: f.store.account,
        }),
        /InvalidCart|InvalidQuantity/,
      );
      assert.equal(
        await f.token.read.usedPurchaseNonces([f.buyer.account.address, 1n]),
        false,
      );
    }
    assert.equal(await f.token.read.balanceOf([f.buyer.account.address]), 10n);
    assert.equal(
      (
        await f.token.getEvents.PurchaseCompleted(
          {},
          { fromBlock: 0n, toBlock: "latest" },
        )
      ).length,
      0,
    );
  });
  it("firme legate a buyer, rete, contratto, negozio, carrello e totale", async () => {
    const f = await fixture();
    await f.mint();
    for (const overrides of [
      { buyer: f.other.account.address },
      { chainId: 1 },
      { contractAddress: f.other.account.address },
    ])
      await assert.rejects(
        f.token.write.purchase(await f.quote(overrides), {
          account: f.store.account,
        }),
        /InvalidSignature/,
      );
    await assert.rejects(
      f.token.write.purchase(await f.quote({}, f.other), {
        account: f.store.account,
      }),
      /InvalidSignature/,
    );
    const q = await f.quote();
    await f.token.write.registerPoint([3n, 1, 3, f.store.account.address]);
    await assert.rejects(
      f.token.write.purchase([q[0], 3n, ...q.slice(2)] as typeof q, {
        account: f.store.account,
      }),
      /InvalidSignature/,
    );
    await assert.rejects(
      f.token.write.purchase(
        [q[0], q[1], [1n], [1n], ...q.slice(4)] as typeof q,
        {
          account: f.store.account,
        },
      ),
      /InvalidSignature/,
    );
    await assert.rejects(
      f.token.write.purchase(
        [q[0], q[1], q[2], q[3], 6n, ...q.slice(5)] as typeof q,
        { account: f.store.account },
      ),
      /InvalidSignature/,
    );
    await f.token.write.setPointOperator([2n, f.other.account.address]);
    await assert.rejects(
      f.token.write.purchase(q, { account: f.other.account }),
      /InvalidSignature/,
    );
  });
  it("scadenza, prezzo, saldo, stato negozio e replay sono atomici", async () => {
    const f = await fixture();
    await f.mint();
    const q = await f.quote();
    await f.token.write.setPointActive([2n, false]);
    await assert.rejects(
      f.token.write.purchase(q, { account: f.store.account }),
      /InvalidPoint/,
    );
    await f.token.write.setPointActive([2n, true]);
    await f.token.write.setProduct([2n, "Pane", 3n]);
    await assert.rejects(
      f.token.write.purchase(q, { account: f.store.account }),
      /PriceChanged/,
    );
    await f.token.write.setProduct([2n, "Pane", 2n]);
    const expensive = await f.quote({
      ids: [4n],
      quantities: [4n],
      maxTotal: 12n,
    });
    await assert.rejects(
      f.token.write.purchase(expensive, { account: f.store.account }),
      /ERC20InsufficientBalance/,
    );
    assert.equal(
      await f.token.read.usedPurchaseNonces([f.buyer.account.address, 1n]),
      false,
    );
    assert.equal(await f.token.read.totalSupply(), 10n);
    await f.token.write.purchase(q, { account: f.store.account });
    await assert.rejects(
      f.token.write.purchase(q, { account: f.store.account }),
      /NonceAlreadyUsed/,
    );
    await assert.rejects(
      f.token.write.purchase(
        await f.quote({ ids: [4n], quantities: [2n], maxTotal: 6n, nonce: 2n }),
        { account: f.store.account },
      ),
      /ERC20InsufficientBalance/,
    );
    const expired = await f.quote({ nonce: 3n });
    await f.networkHelpers.time.increase(301);
    await assert.rejects(
      f.token.write.purchase(expired, { account: f.store.account }),
      /QuoteExpired/,
    );
    assert.equal(
      await f.token.read.usedPurchaseNonces([f.buyer.account.address, 3n]),
      false,
    );
    assert.equal(await f.token.read.totalSupply(), 5n);
    assert.equal(
      (
        await f.token.getEvents.PurchaseCompleted(
          {},
          { fromBlock: 0n, toBlock: "latest" },
        )
      ).length,
      1,
    );
  });
  it("cliente con zero ETH: firma soltanto, gas pagato dal supermercato", async () => {
    const f = await fixture();
    await f.mint();
    await f.networkHelpers.setBalance(f.buyer.account.address, 0n);
    const before = await f.client.getBalance({
      address: f.store.account.address,
    });
    const hash = await f.token.write.purchase(await f.quote(), {
      account: f.store.account,
    });
    const receipt = await f.client.getTransactionReceipt({ hash });
    const tx = await f.client.getTransaction({ hash });
    assert.equal(tx.from.toLowerCase(), f.store.account.address.toLowerCase());
    assert.equal(
      await f.client.getBalance({ address: f.buyer.account.address }),
      0n,
    );
    assert.equal(
      before -
        (await f.client.getBalance({ address: f.store.account.address })),
      receipt.gasUsed * receipt.effectiveGasPrice,
    );
    assert.equal(await f.token.read.balanceOf([f.buyer.account.address]), 5n);
  });
  it("nessun acquisto senza consenso del buyer o da un operatore diverso", async () => {
    const f = await fixture();
    await f.mint();
    const q = await f.quote();
    await assert.rejects(
      f.token.write.purchase(q, { account: f.buyer.account }),
      /UnauthorizedOperator/,
    );
    await assert.rejects(
      f.token.write.purchase(q, { account: f.other.account }),
      /UnauthorizedOperator/,
    );
    await assert.rejects(
      f.token.write.purchase(await f.quote({}, f.store, f.other), {
        account: f.store.account,
      }),
      /InvalidSignature/,
    );
    await assert.rejects(
      f.token.write.purchase([...q.slice(0, 8), "0x"] as typeof q, {
        account: f.store.account,
      }),
      /ECDSAInvalidSignatureLength/,
    );
    const self = await f.quote(
      { buyer: f.store.account.address },
      f.store,
      f.store,
    );
    await assert.rejects(
      f.token.write.purchase([...self.slice(0, 8), self[7]] as typeof self, {
        account: f.store.account,
      }),
      /InvalidSignature/,
    );
    assert.equal(await f.token.read.totalSupply(), 10n);
    assert.equal(
      await f.token.read.usedPurchaseNonces([f.buyer.account.address, 1n]),
      false,
    );
  });
});
