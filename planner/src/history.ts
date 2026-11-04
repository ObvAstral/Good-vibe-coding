import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { decodeEventLog } from 'viem';
import type { Deployment } from '../../shared/src/protocol.js';
import { capture, usage } from './analytics.js';
import { deploymentKey, type SyncState } from './indexer.js';
import { setState, state, stringify, type DB } from './db.js';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const names = new Set(['PointRegistered','PointStatusChanged','PointOperatorChanged','BottlesDeposited','PurchaseCompleted']);
export function importHistory(db: DB, directory: string) {
  directory = resolve(directory);
  const read = (name: string) => { if (basename(name) !== name) throw new Error('Nome file storico non valido.'); return readFileSync(resolve(directory,name)); };
  const manifest = JSON.parse(read('manifest.json').toString());
  if (manifest.protocolVersion !== '3' || manifest.chainId !== 31337 || manifest.simulated !== true) throw new Error('Pacchetto storico non compatibile.');
  for (const [file,expected] of Object.entries(manifest.checksums)) if (sha(read(file)) !== expected) throw new Error(`Checksum storico diverso: ${file}`);
  const identity = sha(read('manifest.json'));
  const previous = state<SyncState>(db,'sync');
  if (previous?.source === 'history' && state<string>(db,'historyHash') === identity) return previous;
  const deployment = JSON.parse(read('deployment.json').toString()) as Deployment;
  if (deployment.protocolVersion !== '3' || deploymentKey(deployment) !== `${manifest.chainId}/${manifest.contractAddress.toLowerCase()}/${manifest.deploymentBlockHash.toLowerCase()}`) throw new Error('Identità storico e deployment diverse.');
  const lines = (name:string) => read(name).toString().trim().split('\n').map(line=>JSON.parse(line));
  const operations = lines('events.jsonl'), transactions = lines('transactions.jsonl');
  const docs = lines('rag-documents.jsonl');
  if (operations.length !== manifest.counts.operationalTransactions || docs.length !== manifest.counts.ragDocuments) throw new Error('Conteggi storico incoerenti.');
  const decoded: {tx:string;index:number;block:number;hash:string;timestamp:number;event:string;args:any}[] = [];
  for (const tx of transactions) {
    const receipt = tx.receipt;
    if (receipt.status !== 'success') throw new Error('Receipt fallita nel pacchetto.');
    for (const raw of receipt.logs) {
      if (raw.address.toLowerCase() !== deployment.contractAddress.toLowerCase()) continue;
      const log = decodeEventLog({abi:deployment.abi,topics:raw.topics,data:raw.data,strict:true});
      if (!log.eventName || !names.has(log.eventName)) continue;
      decoded.push({tx:receipt.transactionHash.toLowerCase(),index:Number(raw.logIndex),block:Number(receipt.blockNumber),hash:receipt.blockHash,
        timestamp:Date.parse(tx.timestamp)/1000,event:log.eventName,args:JSON.parse(stringify(log.args))});
    }
  }
  decoded.sort((a,b)=>a.block-b.block || a.index-b.index);
  const keys = new Set(decoded.map(l=>`${l.tx}/${l.index}`));
  if (keys.size !== decoded.length) throw new Error('Log duplicati nelle ricevute.');
  const operational = decoded.filter(l=>['BottlesDeposited','PurchaseCompleted'].includes(l.event));
  if (operational.length !== operations.length) throw new Error('Eventi e receipt divergenti.');
  const normalized = new Map(operations.map(e=>[`${e.transactionHash.toLowerCase()}/${e.logIndex}`,e]));
  for (const event of operational) {
    const original = normalized.get(`${event.tx}/${event.index}`);
    if (!original || original.chainId !== 31337 || original.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase()
      || original.blockHash !== event.hash || original.eventName !== event.event || Date.parse(original.timestamp)/1000 !== event.timestamp
      || !isDeepStrictEqual(original.args,event.args)) throw new Error('Evento normalizzato non corrispondente alla receipt.');
  }
  for (const doc of docs) {
    if (doc.contentHash !== sha(doc.text) || doc.metadata.simulated !== true || /0x[0-9a-fA-F]{40}/.test(doc.text)) throw new Error('Scheda RAG storica non valida.');
  }
  const from = Date.parse(manifest.period.from)/1000, to = Date.parse(manifest.period.to)/1000+1;
  const next: SyncState = {deployment:deploymentKey(deployment),indexedBlock:Number(manifest.indexedBlock),latestBlock:Number(manifest.indexedBlock),
    blockHash:manifest.indexedBlockHash,timestamp:to+1,deploymentTimestamp:decoded[0].timestamp,updatedAt:manifest.generatedAt,simulated:true,source:'history',periodFrom:from,periodTo:to};
  db.transaction(()=>{
    db.prepare('DELETE FROM chain_logs').run();
    const insert = db.prepare('INSERT INTO chain_logs VALUES (?,?,?,?,?,?,?)');
    for (const row of decoded) insert.run(row.tx,row.index,row.block,row.hash,row.timestamp,row.event,stringify(row.args));
    setState(db,'sync',next);
    const totals = usage(capture(db),{from,to});
    for (const [field,value] of Object.entries(manifest.total)) if (String((totals as any)[field]) !== String(value)) throw new Error(`Riconciliazione fallita: ${field}`);
    setState(db,'historyDocuments',docs); setState(db,'historyHash',identity); setState(db,'ragDirty',true);
  })();
  return next;
}
