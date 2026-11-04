import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hash,
} from "viem";
import { json, PROTOCOL_VERSION, type Deployment } from "@riciclo/shared";
import { tokenAbi } from "@riciclo/shared/abi";
import { localAccount, localRpc, assertLocal } from "@riciclo/shared/local";
import { projectRoot, readArtifact } from "@riciclo/shared/deployment";

export async function deployDemo(rpcUrl = localRpc): Promise<Deployment> {
  assertLocal(rpcUrl, 31337);
  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  assertLocal(rpcUrl, chainId);
  const chain = defineChain({
    id: chainId,
    name: "Hardhat locale",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const accounts = Array.from({ length: 5 }, (_, index) => localAccount(index));
  const wallet = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account: accounts[0],
  });
  const hash = await wallet.deployContract({
    abi: tokenAbi,
    bytecode: readArtifact().bytecode,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Deploy fallito.");
  const address = receipt.contractAddress;
  async function confirm(hash: Hash) {
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success")
      throw new Error("Seed fallito.");
  }
  const points = [
    { id: "1", name: "Macchinetta Aurora" },
    { id: "2", name: "Macchinetta Santa Rita" },
    { id: "3", name: "Market Aurora" },
    { id: "4", name: "Market Santa Rita" },
  ];
  // Circoscrizioni 7 (Aurora) e 2 (Santa Rita): metadati dimostrativi.
  for (let i = 0; i < points.length; i++)
    await confirm(
      await wallet.writeContract({
        address,
        abi: tokenAbi,
        functionName: "registerPoint",
        args: [
          BigInt(i + 1),
          i < 2 ? 0 : 1,
          i % 2 === 0 ? 7 : 2,
          accounts[i + 1].address,
        ],
      }),
    );
  for (const [id, name, price] of [
    [1n, "Acqua", 1n],
    [2n, "Pane", 2n],
    [3n, "Prosciutto", 4n],
    [4n, "Tonno", 3n],
  ] as const)
    await confirm(
      await wallet.writeContract({
        address,
        abi: tokenAbi,
        functionName: "setProduct",
        args: [id, name, price],
      }),
    );
  return {
    protocolVersion: PROTOCOL_VERSION,
    chainId,
    contractAddress: address,
    deploymentBlock: receipt.blockNumber.toString(),
    deploymentBlockHash: receipt.blockHash,
    abi: tokenAbi,
    points,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length > 2)
    throw new Error(
      "Il deploy è esclusivamente locale e non accetta opzioni di rete. Usare RPC_URL per una porta Hardhat diversa.",
    );
  const manifest = await deployDemo(process.env.RPC_URL ?? localRpc);
  mkdirSync(`${projectRoot}/deployments`, { recursive: true });
  const path = `${projectRoot}/deployments/local.json`;
  writeFileSync(path, json(manifest) + "\n");
  console.log(
    `Contratto: ${manifest.contractAddress} · chainId ${manifest.chainId}\nManifest: ${path}`,
  );
}
