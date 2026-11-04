import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hash,
} from "viem";
import {
  json,
  PROTOCOL_VERSION,
  FIXED_POINTS,
  NEIGHBORHOODS,
  GEOGRAPHY_SOURCE,
  type Deployment,
} from "@riciclo/shared";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  localAccount,
  localPointOperators,
  localRpc,
  assertLocal,
} from "@riciclo/shared/local";
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
  const operators = localPointOperators();
  const wallet = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account: localAccount(0),
  });
  const hash = await wallet.deployContract({
    abi: tokenAbi,
    bytecode: readArtifact().bytecode,
    args: [operators.machines, operators.stores],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Deploy fallito.");
  const address = receipt.contractAddress;
  async function confirm(hash: Hash) {
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success")
      throw new Error("Seed fallito.");
  }
  const points = FIXED_POINTS.map(({ id, name }) => ({ id, name }));
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
    neighborhoods: NEIGHBORHOODS,
    geographySource: GEOGRAPHY_SOURCE,
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
