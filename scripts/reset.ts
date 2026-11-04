import { rmSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { projectRoot } from "@riciclo/shared/deployment";
const client = createPublicClient({
  transport: http("http://127.0.0.1:8545", { retryCount: 0, timeout: 1000 }),
});
let running = false;
try {
  await client.getChainId();
  running = true;
} catch {}
if (running) throw new Error("Arrestare la rete locale prima del reset.");
for (const name of [
  ".data/local.sqlite",
  ".data/local.sqlite-wal",
  ".data/local.sqlite-shm",
  "deployments/local.json",
])
  rmSync(`${projectRoot}/${name}`, { force: true });
console.log(
  "Manifest e database della demo locale rimossi. Il planner deve ricostruire il proprio indice.",
);
