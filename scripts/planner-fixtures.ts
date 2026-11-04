import type { PublicClient } from "viem";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  json,
  PROTOCOL_VERSION,
  neighborhoodName,
  type Deployment,
} from "@riciclo/shared";
export interface PlannerEvent {
  eventName: "BottlesDeposited" | "PurchaseCompleted";
  chainId: number;
  contractAddress: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  timestamp: string;
  neighborhoodName: string;
  args: Record<string, string | number | string[]>;
}
export async function plannerEvents(
  client: PublicClient,
  deployment: Deployment,
): Promise<PlannerEvent[]> {
  if (deployment.protocolVersion !== PROTOCOL_VERSION)
    throw new Error(
      "Rigenerare manifest e fixture per il protocollo 3 con quartieri.",
    );
  const logs = await client.getContractEvents({
    address: deployment.contractAddress,
    abi: tokenAbi,
    fromBlock: BigInt(deployment.deploymentBlock),
    toBlock: "latest",
  });
  const timestamps = new Map<string, string>();
  const events: PlannerEvent[] = [];
  for (const log of logs) {
    if (
      log.eventName !== "BottlesDeposited" &&
      log.eventName !== "PurchaseCompleted"
    )
      continue;
    const key = String(log.blockNumber);
    if (!timestamps.has(key)) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      timestamps.set(
        key,
        new Date(Number(block.timestamp) * 1000).toISOString(),
      );
    }
    events.push({
      eventName: log.eventName,
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      blockNumber: key,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      timestamp: timestamps.get(key)!,
      neighborhoodName: neighborhoodName(log.args.neighborhoodId!),
      args: JSON.parse(json(log.args)),
    });
  }
  return events;
}
// Reference totals for fixture verification only; this is not a persistent indexer.
export function aggregateFixture(events: PlannerEvent[]) {
  const unique = new Map(
    events.map((e) => [
      `${e.chainId}/${e.contractAddress.toLowerCase()}/${e.transactionHash}/${e.logIndex}`,
      e,
    ]),
  );
  type Bucket = {
    depositCount: bigint;
    bottlesCollected: bigint;
    tokensMinted: bigint;
    purchaseCount: bigint;
    tokensBurned: bigint;
    depositWallets: Set<string>;
    purchaseWallets: Set<string>;
  };
  const empty = (): Bucket => ({
    depositCount: 0n,
    bottlesCollected: 0n,
    tokensMinted: 0n,
    purchaseCount: 0n,
    tokensBurned: 0n,
    depositWallets: new Set(),
    purchaseWallets: new Set(),
  });
  const daily = new Map<string, Bucket>(),
    points = new Map<string, Bucket>(),
    dailyNeighborhood = new Map<string, Bucket>(),
    neighborhoods = new Map<number, Bucket>(),
    pointNeighborhood = new Map<string, number>(),
    total = empty();
  for (const event of unique.values()) {
    const areaId = Number(event.args.neighborhoodId);
    if (!Number.isInteger(areaId))
      throw new Error(
        "Evento senza quartiere: non usare fixture o ABI precedenti al protocollo 3.",
      );
    neighborhoodName(areaId);
    const dayNeighborhood = `${event.timestamp.slice(0, 10)}/${areaId}`;
    const dayZone = `${event.timestamp.slice(0, 10)}/${event.args.zoneId}`;
    const pointId = String(event.args.machineId ?? event.args.storeId);
    if (
      pointNeighborhood.has(pointId) &&
      pointNeighborhood.get(pointId) !== areaId
    )
      throw new Error(
        "Quartiere incoerente per lo stesso punto nel deployment.",
      );
    pointNeighborhood.set(pointId, areaId);
    if (!dailyNeighborhood.has(dayNeighborhood))
      dailyNeighborhood.set(dayNeighborhood, empty());
    if (!neighborhoods.has(areaId)) neighborhoods.set(areaId, empty());
    if (!daily.has(dayZone)) daily.set(dayZone, empty());
    if (!points.has(pointId)) points.set(pointId, empty());
    for (const b of [
      daily.get(dayZone)!,
      points.get(pointId)!,
      dailyNeighborhood.get(dayNeighborhood)!,
      neighborhoods.get(areaId)!,
      total,
    ]) {
      if (event.eventName === "BottlesDeposited") {
        b.depositCount++;
        b.bottlesCollected += BigInt(String(event.args.bottles));
        b.tokensMinted += BigInt(String(event.args.minted));
        b.depositWallets.add(String(event.args.recipient).toLowerCase());
      } else {
        b.purchaseCount++;
        b.tokensBurned += BigInt(String(event.args.burned));
        b.purchaseWallets.add(String(event.args.buyer).toLowerCase());
      }
    }
  }
  const serial = (b: Bucket) => ({
    depositCount: String(b.depositCount),
    bottlesCollected: String(b.bottlesCollected),
    tokensMinted: String(b.tokensMinted),
    purchaseCount: String(b.purchaseCount),
    tokensBurned: String(b.tokensBurned),
    distinctDepositWallets: String(b.depositWallets.size),
    distinctPurchaseWallets: String(b.purchaseWallets.size),
  });
  const area = (id: number) => ({
    neighborhoodId: id,
    neighborhoodName: neighborhoodName(id),
  });
  return {
    byDayNeighborhood: [...dailyNeighborhood.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [day, id] = key.split("/");
        return { day, ...area(Number(id)), ...serial(value) };
      }),
    byNeighborhood: [...neighborhoods.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, value]) => ({ ...area(id), ...serial(value) })),
    byDayZone: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [day, zoneId] = key.split("/");
        return { day, zoneId: Number(zoneId), ...serial(value) };
      }),
    byPoint: [...points.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([pointId, value]) => ({
        pointId,
        ...area(pointNeighborhood.get(pointId)!),
        ...serial(value),
      })),
    total: serial(total),
  };
}
