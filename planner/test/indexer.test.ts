import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDB } from './helpers.js';
import { state } from '../src/db.js';
import { synchronize, type Reader, type ChainLog } from '../src/indexer.js';
import type { Deployment } from '../../shared/src/protocol.js';
const deployment = { protocolVersion:'3', chainId: 31337, contractAddress: '0x1111111111111111111111111111111111111111', deploymentBlock: '1', deploymentBlockHash: 'genesis', abi: [], points: [] } as unknown as Deployment;
test('indice idempotente, conferme, rollback profondo e reset deployment', async () => {
  const db = testDB();
  let version = 'v1';
  const logs = (n: bigint): ChainLog[] => [{ transactionHash: 'tx', logIndex: 0, blockNumber: n, blockHash: `${version}-${n}`, eventName: 'BottlesDeposited', args: { bottles: '10' } }];
  const reader: Reader = { chainId: async () => 31337, head: async () => 50n,
    block: async n => ({ hash: n === 1n ? 'genesis' : `${version}-${n}`, timestamp: n * 100n }),
    logs: async (from, to) => [20n, 49n].filter(n => n >= from && n <= to).flatMap(logs) };
  try {
    await synchronize(db, deployment, reader); await synchronize(db, deployment, reader);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM chain_logs').get() as any).n, 1);
    assert.equal((state(db, 'sync') as any).indexedBlock, 48);
    version = 'v2'; await synchronize(db, deployment, reader);
    assert.equal((db.prepare('SELECT block_hash FROM chain_logs').get() as any).block_hash, 'v2-20');
    await assert.rejects(synchronize(db, { ...deployment, deploymentBlockHash: 'wrong' as any }, reader), /Deployment/);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM chain_logs').get() as any).n, 1);
  } finally { db.close(); }
});
test('errore RPC o rollback durante lettura non attiva uno stato parziale', async () => {
  const db = testDB();
  try {
    const reader: Reader = { chainId: async () => 31337, head: async () => 10n, block: async n => ({ hash: n === 1n ? 'genesis' : 'x', timestamp: n }), logs: async () => { throw new Error('RPC down'); } };
    await assert.rejects(synchronize(db, deployment, reader), /RPC down/);
    assert.equal(state(db, 'sync'), null);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM chain_logs').get() as any).n, 0);
  } finally { db.close(); }
});
