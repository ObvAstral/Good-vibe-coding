import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createPublicClient, http } from "viem";
import { projectRoot } from "@riciclo/shared/deployment";
export async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  timer.unref();
  await stopped;
  clearTimeout(timer);
}
export async function startChain(port: number) {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 500, retryCount: 0 }),
  });
  try {
    await client.getChainId();
    throw new Error(
      `La porta ${port} è già occupata. Non verrà resettata una rete esistente.`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("già occupata"))
      throw error;
  }
  const child = spawn(
    process.execPath,
    [
      `${projectRoot}/node_modules/hardhat/dist/src/cli.js`,
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: `${projectRoot}/contracts`, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (data) => {
    output = (output + data).slice(-5000);
  });
  child.stderr?.on("data", (data) => {
    output = (output + data).slice(-5000);
  });
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null)
      throw new Error(`Hardhat non avviato: ${output}`);
    try {
      if ((await client.getChainId()) === 31337)
        return { rpcUrl, child, client, stop: () => stopChild(child) };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopChild(child);
  throw new Error(`Timeout avvio Hardhat: ${output}`);
}
