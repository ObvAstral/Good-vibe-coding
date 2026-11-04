import { spawn } from "node:child_process";
import { startChain, stopChild } from "./local-chain.js";
import { deployDemo } from "./deploy.js";
import { TerminalService } from "../server/src/service.js";
import { createApp } from "../server/src/app.js";
import { localAccount, localOperators } from "@riciclo/shared/local";
import { projectRoot } from "@riciclo/shared/deployment";
const chain = await startChain(18547);
const deployment = await deployDemo(chain.rpcUrl);
const service = new TerminalService({
  deployment,
  rpcUrl: chain.rpcUrl,
  publicRpcUrl: chain.rpcUrl,
  databasePath: ":memory:",
  operators: localOperators(),
});
await service.validateDeployment();
const app = createApp(service);
await app.listen({ host: "127.0.0.1", port: 18548 });
const vite = spawn(
  process.execPath,
  [
    `${projectRoot}/node_modules/vite/bin/vite.js`,
    "--host",
    "127.0.0.1",
    "--port",
    "5175",
    "--strictPort",
  ],
  {
    cwd: `${projectRoot}/web`,
    env: { ...process.env, API_PROXY_TARGET: "http://127.0.0.1:18548" },
    stdio: "inherit",
  },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stopChild(vite);
  await app.close();
  await service.close();
  await chain.stop();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
vite.on("exit", () => {
  if (!stopping) {
    process.exitCode = 1;
    void stop();
  }
});
