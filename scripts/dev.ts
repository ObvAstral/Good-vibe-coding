import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { projectRoot } from "@riciclo/shared/deployment";
import { json } from "@riciclo/shared";
import { startChain, stopChild } from "./local-chain.js";
async function freePort(port: number) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", () =>
      reject(new Error(`La porta ${port} è già occupata.`)),
    );
    probe.listen(port, "127.0.0.1", () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
await freePort(3001);
await freePort(5173);
if (existsSync(`${projectRoot}/.data/local.sqlite`))
  throw new Error(
    "Stato locale già presente. Eseguire npm run demo:reset prima di creare una nuova rete.",
  );
const compile = spawn("npm", ["run", "compile"], {
  cwd: projectRoot,
  stdio: "inherit",
});
const result = await new Promise<number | null>((resolve, reject) => {
  compile.on("exit", resolve);
  compile.on("error", reject);
});
if (result !== 0) process.exit(result ?? 1);
const { deployDemo } = await import("./deploy.js");
const chain = await startChain(8545);
const children: ChildProcess[] = [chain.child];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) await stopChild(child);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  const manifest = await deployDemo(chain.rpcUrl);
  mkdirSync(`${projectRoot}/deployments`, { recursive: true });
  writeFileSync(`${projectRoot}/deployments/local.json`, json(manifest) + "\n");
  const env = {
    ...process.env,
    RPC_URL: chain.rpcUrl,
    MANIFEST_PATH: `${projectRoot}/deployments/local.json`,
    LOCAL_DEMO: "1",
    DATABASE_PATH: `${projectRoot}/.data/local.sqlite`,
    PORT: "3001",
    HOST: "127.0.0.1",
    API_PROXY_TARGET: "http://127.0.0.1:3001",
  };
  const launch = (args: string[], cwd = projectRoot) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
    children.push(child);
    child.on("exit", () => {
      if (!stopping) {
        process.exitCode = 1;
        void stop();
      }
    });
    return child;
  };
  const server = launch([
    `${projectRoot}/node_modules/tsx/dist/cli.mjs`,
    "server/src/main.ts",
  ]);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (stopping || server.exitCode !== null)
      throw new Error("Il backend non è riuscito ad avviarsi.");
    try {
      const response = await fetch("http://127.0.0.1:3001/api/health", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Timeout avvio backend.");
  launch(
    [
      `${projectRoot}/node_modules/vite/bin/vite.js`,
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    `${projectRoot}/web`,
  );
  console.log(
    "Demo pronta: http://127.0.0.1:5173/macchinetta · RPC http://127.0.0.1:8545 · chainId 31337",
  );
} catch (error) {
  await stop();
  throw error;
}
