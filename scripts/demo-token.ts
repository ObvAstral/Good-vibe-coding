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
import {
  PROTOCOL_VERSION,
  buyerAuthorization,
  purchaseArgs,
  purchaseDomain,
  purchaseMessage,
  purchaseTypes,
  type Quote,
} from "@riciclo/shared";
const rpc = process.env.RPC_URL ?? localRpc,
  deployment = readDeployment();
assertLocal(rpc, deployment.chainId);
if (deployment.protocolVersion !== PROTOCOL_VERSION)
  throw new Error(
    "Serve un nuovo deploy locale del contratto con gas pagato dal supermercato.",
  );
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
const buyerEth = await client.getBalance({ address: buyer.address });
const mine = async (hash: `0x${string}`) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
};
await mine(
  await wallet(machine).writeContract({
    ...contract,
    functionName: "deposit",
    args: [1n, buyer.address, 10n, keccak256(toHex(randomUUID()))],
  }),
);
async function authorize(
  ids: bigint[],
  quantities: bigint[],
  maxTotal: bigint,
) {
  const block = await client.getBlock();
  const issued =
    block.timestamp > BigInt(Math.floor(Date.now() / 1000))
      ? block.timestamp
      : BigInt(Math.floor(Date.now() / 1000));
  const q: Quote = {
    buyer: buyer.address,
    storeId: "4",
    productIds: ids.map(String),
    quantities: quantities.map(String),
    maxTotal: String(maxTotal),
    nonce: BigInt(keccak256(toHex(randomUUID()))).toString(),
    deadline: String(issued + 300n),
    signature: "0x",
  };
  q.signature = await wallet(store).signTypedData({
    domain: purchaseDomain(31337, contract.address),
    types: purchaseTypes,
    primaryType: "Purchase",
    message: purchaseMessage(q),
  });
  const buyerSignature = await buyer.signTypedData(
    buyerAuthorization(q, deployment),
  );
  return purchaseArgs(q, buyerSignature);
}
const storeBefore = await client.getBalance({ address: store.address });
const receipt = await mine(
  await wallet(store).writeContract({
    ...contract,
    functionName: "purchase",
    args: await authorize([2n, 4n], [1n, 1n], 5n),
  }),
);
assert.equal(await client.getBalance({ address: buyer.address }), buyerEth);
assert.equal(
  storeBefore - (await client.getBalance({ address: store.address })),
  receipt.gasUsed * receipt.effectiveGasPrice,
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
  await assert.rejects(
    client.simulateContract({
      ...contract,
      account: store,
      functionName: "purchase",
      args: await authorize([4n], [2n], 6n),
    }),
    /ERC20InsufficientBalance/,
  );
  console.log("Acquisto da 6 RCS respinto: saldo invariato.");
}
console.log(
  `Demo completata: 10 bottiglie → 10 RCS → burn 5. Saldo ${after} RCS. Gas pagato dal supermercato; ETH del cliente invariati.`,
);
