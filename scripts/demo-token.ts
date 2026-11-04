import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toHex,
} from "viem";
import { readDeployment } from "@riciclo/shared/deployment";
import { tokenAbi } from "@riciclo/shared/abi";
import { localAccount, localRpc, assertLocal } from "@riciclo/shared/local";
import { cartHash, purchaseDomain, purchaseTypes } from "@riciclo/shared";
const rpc = process.env.RPC_URL ?? localRpc;
const deployment = readDeployment();
const client = createPublicClient({ transport: http(rpc) });
assertLocal(rpc, await client.getChainId());
const chain = defineChain({
  id: 31337,
  name: "Locale",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const buyer = localAccount(5),
  machine = localAccount(1),
  store = localAccount(4);
const wallet = (account: ReturnType<typeof localAccount>) =>
  createWalletClient({ chain, account, transport: http(rpc) });
const contract = { address: deployment.contractAddress, abi: tokenAbi };
const supplyBefore = await client.readContract({
  ...contract,
  functionName: "totalSupply",
});
const before = await client.readContract({
  ...contract,
  functionName: "balanceOf",
  args: [buyer.address],
});
async function mine(hash: `0x${string}`) {
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
}
await mine(
  await wallet(machine).writeContract({
    ...contract,
    functionName: "deposit",
    args: [1n, buyer.address, 10n, keccak256(toHex(randomUUID()))],
  }),
);
const nonce = BigInt(keccak256(toHex(randomUUID()))),
  deadline = (await client.getBlock()).timestamp + 300n;
const ids = [2n, 4n],
  quantities = [1n, 1n];
const signature = await wallet(store).signTypedData({
  domain: purchaseDomain(31337, contract.address),
  types: purchaseTypes,
  primaryType: "Purchase",
  message: {
    buyer: buyer.address,
    storeId: 4n,
    cartHash: cartHash(ids, quantities),
    maxTotal: 5n,
    nonce,
    deadline,
  },
});
await mine(
  await wallet(buyer).writeContract({
    ...contract,
    functionName: "purchase",
    args: [4n, ids, quantities, 5n, nonce, deadline, signature],
  }),
);
const after = await client.readContract({
  ...contract,
  functionName: "balanceOf",
  args: [buyer.address],
});
assert.equal(after, before + 5n);
assert.equal(
  await client.readContract({ ...contract, functionName: "totalSupply" }),
  supplyBefore + 5n,
);
if (before === 0n) {
  const badIds = [4n],
    badQty = [2n];
  const bad = await wallet(store).signTypedData({
    domain: purchaseDomain(31337, contract.address),
    types: purchaseTypes,
    primaryType: "Purchase",
    message: {
      buyer: buyer.address,
      storeId: 4n,
      cartHash: cartHash(badIds, badQty),
      maxTotal: 6n,
      nonce: nonce + 1n,
      deadline,
    },
  });
  await assert.rejects(
    client.simulateContract({
      ...contract,
      account: buyer,
      functionName: "purchase",
      args: [4n, badIds, badQty, 6n, nonce + 1n, deadline, bad],
    }),
    /ERC20InsufficientBalance/,
  );
  console.log("Acquisto da 6 RCS respinto: saldo invariato.");
}
console.log(
  `Demo completata: 10 bottiglie → 10 RCS → burn 5. Saldo ${after} RCS (iniziale ${before}).`,
);
