import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { readDeployment, projectRoot } from "@riciclo/shared/deployment";
import { localRpc, assertLocal } from "@riciclo/shared/local";
import { json } from "@riciclo/shared";
import { plannerEvents, aggregateFixture } from "./planner-fixtures.js";
const deployment = readDeployment();
assertLocal(process.env.RPC_URL ?? localRpc, deployment.chainId);
const client = createPublicClient({
  transport: http(process.env.RPC_URL ?? localRpc),
});
if ((await client.getChainId()) !== deployment.chainId)
  throw new Error("Rete e manifest differenti.");
const events = await plannerEvents(client, deployment);
const head = await client.getBlock();
mkdirSync(`${projectRoot}/.data`, { recursive: true });
const path = `${projectRoot}/.data/planner-events.json`;
writeFileSync(
  path,
  json({
    source: "hardhat_local",
    physicalDepositsSimulated: true,
    exportedAt: new Date().toISOString(),
    indexedBlock: head.number,
    finality: "latest; esportazione fixture, non indice con conferme",
    period: events.length
      ? { from: events[0].timestamp, to: events.at(-1)!.timestamp }
      : null,
    deployment,
    events,
    expected: aggregateFixture(events),
  }) + "\n",
);
console.log(`Esportati ${events.length} eventi applicativi in ${path}`);
