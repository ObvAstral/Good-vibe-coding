import { createPublicClient, http } from 'viem';
import type { Deployment } from '../../shared/src/protocol.js';
import { assertLocal } from '../../shared/src/local.js';
import { state, setState, stringify, type DB } from './db.js';

export type ChainLog = { transactionHash: string; logIndex: number; blockNumber: bigint; blockHash: string; eventName: string; args: Record<string, unknown> };
export interface Reader {
  chainId(): Promise<number>;
  head(): Promise<bigint>;
  block(n: bigint): Promise<{ hash: string; timestamp: bigint }>;
  logs(from: bigint, to: bigint): Promise<ChainLog[]>;
}
export type SyncState = { deployment: string; indexedBlock: number; blockHash: string; timestamp: number; deploymentTimestamp?: number; latestBlock: number; updatedAt: string; simulated: true; source?:'history'|'live'; periodFrom?:number;periodTo?:number };
export const deploymentKey = (d: Deployment) => `${d.chainId}/${d.contractAddress.toLowerCase()}/${d.deploymentBlockHash.toLowerCase()}`;
const accepted = new Set(['PointRegistered', 'PointStatusChanged', 'PointOperatorChanged', 'BottlesDeposited', 'PurchaseCompleted']);
export function rpcReader(deployment: Deployment, url: string): Reader {
  assertLocal(url, deployment.chainId);
  const client = createPublicClient({ transport: http(url, { timeout: 15000, retryCount: 0 }) });
  return {
    chainId: () => client.getChainId(), head: () => client.getBlockNumber({ cacheTime: 0 }),
    async block(n) { const b = await client.getBlock({ blockNumber: n }); return { hash: b.hash!, timestamp: b.timestamp }; },
    async logs(fromBlock, toBlock) {
      const logs = await client.getContractEvents({ address: deployment.contractAddress, abi: deployment.abi, fromBlock, toBlock, strict: true });
      return logs.filter(l => accepted.has(l.eventName)).map(l => ({ ...l, args: l.args as Record<string, unknown> }));
    },
  };
}
export async function synchronize(db: DB, deployment: Deployment, reader: Reader) {
  if (deployment.protocolVersion !== '3') throw new Error('Il planner richiede un manifest di protocollo 3.');
  if (deployment.chainId !== 31337 || await reader.chainId() !== deployment.chainId) throw new Error('Manifest e rete Hardhat non corrispondono.');
  const start = BigInt(deployment.deploymentBlock), latest = await reader.head();
  if (latest < start || (await reader.block(start)).hash.toLowerCase() !== deployment.deploymentBlockHash.toLowerCase()) throw new Error('Deployment non più presente: aggiornare il manifest dopo il reset.');
  const key = deploymentKey(deployment), old = state<SyncState>(db, 'sync');
  const tip = latest - 2n;
  if (tip < start) throw new Error('Attendere almeno due blocchi dopo il deployment.');
  let from = start;
  if (old?.deployment === key && old.source !== 'history' && BigInt(old.indexedBlock) <= tip) {
    const canonical = await reader.block(BigInt(old.indexedBlock));
    // A changed cursor hash can be a deep reorg: rebuild from deployment for safety.
    if (canonical.hash === old.blockHash) from = BigInt(Math.max(Number(start), old.indexedBlock - 11));
  }
  const rows: unknown[][] = [];
  const headers = new Map<string, { hash: string; timestamp: bigint }>();
  for (let lower = from; lower <= tip; lower += 1000n) {
    const upper = lower + 999n < tip ? lower + 999n : tip;
    for (const log of await reader.logs(lower, upper)) {
      if (!accepted.has(log.eventName)) continue;
      const n = String(log.blockNumber);
      if (!headers.has(n)) headers.set(n, await reader.block(log.blockNumber));
      const block = headers.get(n)!;
      if (block.hash !== log.blockHash) throw new Error('Catena cambiata durante la sincronizzazione. Riprovare.');
      rows.push([log.transactionHash.toLowerCase(), log.logIndex, Number(log.blockNumber), log.blockHash, Number(block.timestamp), log.eventName, stringify(log.args)]);
    }
  }
  const head = await reader.block(tip);
  if ((await reader.block(start)).hash.toLowerCase() !== deployment.deploymentBlockHash.toLowerCase() || (await reader.block(tip)).hash !== head.hash) throw new Error('Reset o rollback durante la sincronizzazione.');
  // Recheck every observed block before committing a consistent snapshot.
  for (const [n, block] of headers) if ((await reader.block(BigInt(n))).hash !== block.hash) throw new Error('Rollback durante la sincronizzazione.');
  const next: SyncState = { deployment: key, indexedBlock: Number(tip), blockHash: head.hash, timestamp: Number(head.timestamp), deploymentTimestamp: Number((await reader.block(start)).timestamp), latestBlock: Number(latest), updatedAt: new Date().toISOString(), simulated: true,source:'live' };
  db.transaction(() => {
    if (old?.deployment !== key || old.source === 'history') db.prepare('DELETE FROM chain_logs').run();
    else db.prepare('DELETE FROM chain_logs WHERE block_number>=?').run(Number(from));
    const insert = db.prepare('INSERT OR REPLACE INTO chain_logs VALUES (?,?,?,?,?,?,?)');
    for (const row of rows) insert.run(...row);
    setState(db, 'sync', next);
    if (old?.deployment !== key || old.indexedBlock !== next.indexedBlock || old.blockHash !== next.blockHash) setState(db, 'ragDirty', true);
  })();
  return next;
}
