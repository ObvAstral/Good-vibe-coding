import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";
import type { Deployment } from "./protocol.js";
export const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
export function readDeployment(
  path = process.env.MANIFEST_PATH ?? `${projectRoot}/deployments/local.json`,
): Deployment {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      `Manifest non disponibile: ${path}. Eseguire prima il deploy.`,
    );
  }
}
export function readArtifact(): { abi: Abi; bytecode: `0x${string}` } {
  return JSON.parse(
    readFileSync(
      `${projectRoot}/contracts/artifacts/src/RicicloSolidale.sol/RicicloSolidale.json`,
      "utf8",
    ),
  );
}
