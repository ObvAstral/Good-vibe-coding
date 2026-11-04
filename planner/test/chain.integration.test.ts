import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWalletClient, http } from 'viem';
import { localAccount } from '../../shared/src/local.js';
import { startChain } from '../../scripts/local-chain.js';
import { deployDemo } from '../../scripts/deploy.js';
import { rpcReader, synchronize } from '../src/indexer.js';
import { openDB } from '../src/db.js';
test('lettura reale Hardhat: conferme, operazione riuscita, revert escluso e reset', async () => {
  const chain = await startChain(18549), db = openDB(':memory:');
  try {
    const beforeDeployment = await chain.client.request({ method: 'evm_snapshot' as any });
    const deployment = await deployDemo(chain.rpcUrl);
    const wallet = createWalletClient({ account: localAccount(1), transport: http(chain.rpcUrl) });
    const hash = await wallet.writeContract({ address: deployment.contractAddress, abi: deployment.abi, chain: null, functionName: 'deposit', args: [1n, localAccount(5).address, 10n, `0x${'11'.repeat(32)}`] });
    await chain.client.waitForTransactionReceipt({ hash });
    await assert.rejects(wallet.writeContract({ address: deployment.contractAddress, abi: deployment.abi, chain: null, functionName: 'deposit', args: [1n, localAccount(5).address, 0n, `0x${'22'.repeat(32)}`] }));
    await chain.client.request({ method: 'hardhat_mine' as any, params: ['0x2'] as any });
    const reader = rpcReader(deployment, chain.rpcUrl);
    await synchronize(db, deployment, reader); await synchronize(db, deployment, reader);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM chain_logs WHERE event='BottlesDeposited'").get() as any).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM chain_logs WHERE event='PointRegistered'").get() as any).n, 16);
    await chain.client.request({ method: 'evm_revert' as any, params: [beforeDeployment] as any });
    await assert.rejects(synchronize(db, deployment, reader), /Deployment/);
  } finally { db.close(); await chain.stop(); }
});
