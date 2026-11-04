import { mnemonicToAccount } from "viem/accounts";
// Public Hardhat development mnemonic: only for an isolated local chain.
export const localAccount = (addressIndex: number) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex },
  );
export const localRpc = "http://127.0.0.1:8545";
export function assertLocal(url: string, chainId: number) {
  if (
    chainId !== 31337 ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error("Le chiavi demo richiedono RPC locale e chainId 31337.");
}
