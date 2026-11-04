import { privateKeyToAccount } from "viem/accounts";
import { readDeployment } from "@riciclo/shared/deployment";
import {
  assertLocal,
  localAccount,
  localOperators,
  localRpc,
} from "@riciclo/shared/local";
import { TerminalService } from "./service.js";
import { createApp } from "./app.js";
const deployment = readDeployment();
const rpcUrl = process.env.RPC_URL ?? localRpc;
const local = process.env.LOCAL_DEMO !== "0";
assertLocal(rpcUrl, deployment.chainId);
const operators = local
  ? localOperators()
  : [
      "MACHINE_1_PRIVATE_KEY",
      "MACHINE_2_PRIVATE_KEY",
      "STORE_1_PRIVATE_KEY",
      "STORE_2_PRIVATE_KEY",
      "STORE_3_PRIVATE_KEY",
      "STORE_4_PRIVATE_KEY",
      "STORE_5_PRIVATE_KEY",
      "STORE_6_PRIVATE_KEY",
    ].map((name) => {
      const key = process.env[name];
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
        throw new Error(`Configurare ${name}.`);
      return privateKeyToAccount(key as `0x${string}`);
    });
const publicRpcUrl = process.env.PUBLIC_RPC_URL ?? rpcUrl;
assertLocal(publicRpcUrl, deployment.chainId);
const service = new TerminalService({
  deployment,
  rpcUrl,
  publicRpcUrl,
  databasePath: process.env.DATABASE_PATH ?? ".data/local.sqlite",
  operators,
});
await service.validateDeployment();
const app = createApp(service, true);
let recovering = false;
const timer = setInterval(() => {
  if (!recovering) {
    recovering = true;
    service
      .recover()
      .catch((error) => app.log.error(error))
      .finally(() => {
        recovering = false;
      });
  }
}, 2000);
timer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await app.close();
  await service.close();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
  });
} catch (error) {
  await stop();
  throw error;
}
