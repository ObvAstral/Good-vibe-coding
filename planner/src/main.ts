import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDB, setState } from './db.js';
import { rpcReader, synchronize } from './indexer.js';
import { openVectors, Retrieval } from './rag.js';
import { Provider } from './provider.js';
import { Chat } from './chat.js';
import { createManager, createPlannerApp } from './app.js';
import type { Deployment } from '../../shared/src/protocol.js';
import { projectRoot } from './embedding.js';
import { importHistory } from './history.js';

const db = openDB(resolve(projectRoot, process.env.PLANNER_DB_PATH ?? 'data/processed/planner.sqlite'));
const command = process.argv[2] ?? 'serve';
const historyPath = resolve(projectRoot,process.env.PLANNER_HISTORY_PATH ?? 'data/simulated/history-v1');
const sync = async () => {
  const deployment: Deployment = JSON.parse(readFileSync(resolve(projectRoot, process.env.DEPLOYMENT_MANIFEST_PATH ?? 'deployments/local.json'), 'utf8'));
  return synchronize(db, deployment, rpcReader(deployment, process.env.HARDHAT_RPC_URL ?? 'http://127.0.0.1:8545'));
};
if (command === 'history') {
  try {console.log(importHistory(db,historyPath));} finally {db.close();}
} else if (command === 'user') {
  let password = '';
  process.stdout.write('Password da stdin (almeno 12 caratteri; non passarla come argomento):\n');
  for await (const chunk of process.stdin) password += chunk;
  createManager(db, process.argv[3] ?? '', password.trimEnd());
  console.log('Gestore configurato.'); db.close();
} else if (command === 'sync') {
  try { console.log(await sync()); } finally { db.close(); }
} else if (command === 'index' || command === 'serve') {
  if ((process.env.PLANNER_SOURCE ?? 'history') === 'history') importHistory(db,historyPath);
  let vectors = null;
  try { vectors = await openVectors(); }
  catch (error) {
    if (command === 'index') { db.close(); throw error; }
    console.error('RAG non pronto:', (error as Error).message);
  }
  const rag = new Retrieval(db, vectors);
  if (command === 'index') {
    try { const snapshot = await rag.build(); console.log(`Indice attivo: ${snapshot.id}`); }
    finally { await vectors?.close(); db.close(); }
  } else {
    const provider = new Provider(db, { apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL,
      budget: Number(process.env.AI_BUDGET_USD ?? '0.60'),
      ...(process.env.DEEPSEEK_INPUT_PRICE ? { inputPrice: Number(process.env.DEEPSEEK_INPUT_PRICE) } : {}),
      ...(process.env.DEEPSEEK_OUTPUT_PRICE ? { outputPrice: Number(process.env.DEEPSEEK_OUTPUT_PRICE) } : {}),
    });
    const app = createPlannerApp(db, new Chat(db, rag, provider));
    let syncing = false;
    const refresh = async () => {
      if (syncing) return; syncing = true;
      try { await sync(); setState(db, 'syncError', null); }
      catch { setState(db, 'syncError', 'Sincronizzazione non disponibile: controllare nodo e manifest.'); }
      finally { syncing = false; }
    };
    const live = process.env.PLANNER_SOURCE === 'live';
    if (live) await refresh();
    const timer = live ? setInterval(() => void refresh(), 30000) : undefined;
    const port = Number(process.env.PLANNER_PORT ?? '3002');
    await app.listen({ host: '127.0.0.1', port });
    console.log(`Planner: http://127.0.0.1:${port}; interfaccia /gestione/chat sul frontend Vite.`);
    let closing = false;
    const close = async () => {
      if (closing) return; closing = true; if(timer) clearInterval(timer);
      await app.close();
      while (syncing) await new Promise(r => setTimeout(r, 50));
      try { await vectors?.close(); } finally { db.close(); }
    };
    process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
  }
} else { db.close(); throw new Error('Comando planner sconosciuto.'); }
