import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hash,
  type Hex,
  type Abi,
} from "viem";
export const purchaseTypes = {
  Purchase: [
    { name: "buyer", type: "address" },
    { name: "storeId", type: "uint256" },
    { name: "cartHash", type: "bytes32" },
    { name: "maxTotal", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export function purchaseDomain(chainId: number, verifyingContract: Address) {
  return {
    name: "Riciclo Solidale",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}
export function cartHash(
  ids: readonly bigint[],
  quantities: readonly bigint[],
): Hash {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256[]" }],
      [ids, quantities],
    ),
  );
}
export interface Deployment {
  chainId: number;
  contractAddress: Address;
  deploymentBlock: string;
  deploymentBlockHash: Hash;
  abi: Abi;
  points: { id: string; name: string }[];
}
export interface Quote {
  buyer: Address;
  storeId: string;
  productIds: string[];
  quantities: string[];
  maxTotal: string;
  nonce: string;
  deadline: string;
  signature: Hex;
}
export interface Point {
  id: string;
  kind: number;
  zoneId: number;
  operator: Address;
  active: boolean;
  name: string;
}
export interface Product {
  id: string;
  name: string;
  price: string;
}
export interface DepositResult {
  requestId: string;
  txHash: Hash | null;
  status: "prepared" | "pending" | "confirmed" | "failed";
  error?: string;
}
export const purchaseArgs = (q: Quote) =>
  [
    BigInt(q.storeId),
    q.productIds.map(BigInt),
    q.quantities.map(BigInt),
    BigInt(q.maxTotal),
    BigInt(q.nonce),
    BigInt(q.deadline),
    q.signature,
  ] as const;
export const json = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
