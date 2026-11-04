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

// The buyer remains account 5. Two machine operators serve the ten fixed machines.
export const localOperators = () => [1, 2, 3, 4, 6, 7, 8, 9].map(localAccount);
export const localPointOperators = () => ({
  machines: [localAccount(1).address, localAccount(2).address] as const,
  stores: [
    localAccount(3).address,
    localAccount(4).address,
    localAccount(6).address,
    localAccount(7).address,
    localAccount(8).address,
    localAccount(9).address,
  ] as const,
});
