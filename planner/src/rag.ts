import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { openEmbedding, queryPrefix, validateVectors, projectRoot } from './embedding.js';
import { capture, usage, defaultPeriod, type Input } from './analytics.js';
import { setState, state, stringify, type DB } from './db.js';
export type Document = { id: string; content: string; areaId: string | null; year: number | null; sources: string[]; period: { from: number; to: number } | null };
export type Snapshot = { id: string; workspace: string; payload: Input };
export const evidencePeriod = (query:string,p:{from:number;to:number}|null) => p && /andamento|trend|varia|crescit|calo/i.test(query) ? {from:p.from-(p.to-p.from),to:p.to} : p;
export interface VectorStore {
  identity: string;
  save(workspace: string, docs: Document[]): Promise<string[]>;
  search(workspace: string, query: string, topK: number): Promise<{id: string; content: string; score: number}[]>;
  reindex?(workspace:string):Promise<void>;
  closeWorkspace(workspace: string, remove?: boolean): Promise<void>;
  close(): Promise<void>;
}
export async function openVectors(): Promise<VectorStore> {
  const { sdk, modelId, sha256 } = await openEmbedding();
  const identity = `${sha256}:last:1024:${queryPrefix}`;
  const directory = resolve(projectRoot,'.qvac/planner'); mkdirSync(directory,{recursive:true});
  const cache = new Database(resolve(directory,'embeddings.sqlite'));
  cache.pragma('journal_mode=WAL'); cache.pragma('busy_timeout=5000');
  cache.exec('CREATE TABLE IF NOT EXISTS embeddings(model TEXT,hash TEXT,vector TEXT NOT NULL,PRIMARY KEY(model,hash))');
  return {
    identity,
    async save(workspace, docs) {
      const ids: string[] = [];
      for (const [index, doc] of docs.entries()) {
        // A byte bound is conservative for byte-fallback tokenizers (well below 32k context).
        if (Buffer.byteLength(doc.content, 'utf8') > 1200) throw new Error(`Scheda troppo lunga: ${doc.id}`);
        const contentHash = createHash('sha256').update(doc.content).digest('hex');
        const cached = cache.prepare('SELECT vector FROM embeddings WHERE model=? AND hash=?').get(identity,contentHash) as {vector:string}|undefined;
        const embedding = cached ? JSON.parse(cached.vector) as number[] : (await sdk.embed({ modelId, text: doc.content })).embedding;
        validateVectors([embedding], 1, 1024);
        if (!cached) cache.prepare('INSERT OR REPLACE INTO embeddings VALUES (?,?,?)').run(identity,contentHash,JSON.stringify(embedding));
        const results = await sdk.ragSaveEmbeddings({ workspace, documents: [{ id: doc.id, content: doc.content, embedding, embeddingModelId: modelId }] });
        if (results.length !== 1 || results[0].status !== 'fulfilled' || !results[0].id) throw new Error(`Indicizzazione QVAC incompleta (${doc.id}): ${results.map(r => r.error ?? r.status).join('; ')}`);
        ids.push(results[0].id);
        if ((index + 1) % 100 === 0) console.log(`QVAC: ${index + 1}/${docs.length} schede indicizzate.`);
      }
      return ids;
    },
    search: (workspace, query, topK) => sdk.ragSearch({ workspace, modelId, query: queryPrefix + query, topK,n:16 }, { timeout: 8000 }),
    async reindex(workspace) {
      const result=await sdk.ragReindex({workspace},{timeout:120000});
      if(!result.reindexed) throw new Error('Ribilanciamento indice QVAC non riuscito.');
    },
    async closeWorkspace(workspace, remove = false) {
      try { await sdk.ragCloseWorkspace({ workspace }); }
      catch (error) { if (!remove) throw error; }
      // close(deleteOnClose) cannot delete a workspace that was left closed by a prior process.
      if (remove) await sdk.ragDeleteWorkspace({ workspace });
    },
    async close() { try { await sdk.unloadModel({ modelId }).catch(()=>{}); } finally { try { await sdk.close(); } finally { cache.close(); } } },
  };
}
export function documentsFor(input: Input): Document[] {
  const docs: Document[] = [];
  const add = (doc: Document) => {
    // Split at words, retaining the document and source IDs in each fragment.
    let text = '', part = 0;
    for (const word of doc.content.split(/\s+/)) {
      if (Buffer.byteLength(word) > 1000) throw new Error(`Parola oltre il limite: ${doc.id}`);
      if (Buffer.byteLength(text + ' ' + word) > 1000) { docs.push({ ...doc, id: `${doc.id}:${part++}`, content: text }); text = ''; }
      text += (text ? ' ' : '') + word;
    }
    if (text) docs.push({ ...doc, id: `${doc.id}:${part}`, content: text });
  };
  for (const q of input.neighborhoods) {
    add({ id: `neighborhood:${q.id}:population:2025`, areaId: q.id, year: 2025, period: null, sources: [q.source],
      content: `Quartiere ${q.name} (ID ${q.id}). Popolazione 2025: ${q.population}. Fonte demografica comunale. Quartieri e zone statistiche sono unità diverse.` });
    const partnerSource = input.sources.find(s => s.file === 'attivita_commerciali_geo.zip');
    if (partnerSource) add({ id: `neighborhood:${q.id}:potential-partners`, areaId: q.id, year: null, period: null, sources: [partnerSource.id],
      content: `Quartiere ${q.name}. Record alimentari o misti di piccole, medie e grandi strutture nelle zone associate: ${input.potentialPartners.filter(r => input.zones.some(z => z.id === r.zoneId && z.neighborhoodId === q.id)).reduce((sum,r) => sum+r.count,0)}. Sono partner potenziali, non negozi affiliati o attività di cui sia verificata l'apertura attuale. Associazione territoriale approssimata; revisione del catalogo 2025.` });
    if (input.sync) add({ id: `neighborhood:${q.id}:usage`, areaId: q.id, year: null, period: defaultPeriod(input), sources: ['chain:hardhat'],
      content: `Quartiere ${q.name}. Operazioni Hardhat simulate, non comportamenti reali dei residenti. ${stringify(usage(input, defaultPeriod(input), { neighborhoodId: q.id }))}` });
  }
  for (const z of input.zones) {
    const q = input.neighborhoods.find(q => q.id === z.neighborhoodId)!;
    add({ id: `zone:${z.id}:social:2023`, areaId: q.id, year: 2023, period: null, sources: [z.socialSource, z.source],
      content: `Quartiere ${q.name}; evidenza della sottozona ${z.name} (${z.id}), attribuzione per massima superficie condivisa (${(z.overlap * 100).toFixed(4)}%). IDISE 2023: ${z.idise ?? 'non pubblicato'}. Popolazione della sottozona 2025: ${z.population}. Non è un indice dell'intero quartiere. I dati mancanti non sono zero.` });
  }
  for (const c of input.context) add({ id: c.id, content: c.content, areaId: null, year: c.year, period: null, sources: [c.source] });
  for (const d of input.historyDocuments ?? []) add({id:d.documentId,content:d.text,areaId:d.metadata.areaId===null?null:String(d.metadata.areaId),year:2026,
    period:d.metadata.from && d.metadata.to ? {from:Date.parse(d.metadata.from)/1000,to:Date.parse(d.metadata.to)/1000+86400}:null,sources:['chain:hardhat']});
  // Metadata in every fragment prevents identical generic prose from crossing area/year filters.
  // HyperDB deduplicates by content, not by the application ID.
  const unique = new Map<string,Document>();
  for (const doc of docs) {
    const content = `[${doc.areaId ? `Quartiere ${doc.areaId}` : 'Contesto generale'}; anno ${doc.year ?? 'operativo'}] ${doc.content}`;
    const prior = unique.get(content);
    if (prior) prior.sources = [...new Set([...prior.sources,...doc.sources])].sort();
    else unique.set(content,{...doc,content});
  }
  return [...unique.values()];
}
export function activeSnapshot(db: DB): Snapshot | null {
  const id = state<string>(db, 'activeSnapshot');
  if (!id) return null;
  const row = db.prepare('SELECT * FROM snapshots WHERE id=?').get(id) as any;
  return row ? { id, workspace: row.workspace, payload: JSON.parse(row.payload) } : null;
}
export class Retrieval {
  constructor(public db: DB, public vectors: VectorStore | null) {}
  async build() {
    const owner = randomUUID();
    this.db.transaction(() => {
      const existing = state<{owner: string; pid: number; expires: number}>(this.db,'indexLock');
      if (existing && existing.expires > Date.now()) {
        let alive = true;
        try { process.kill(existing.pid,0); } catch (error: any) { alive = error.code !== 'ESRCH'; }
        if (alive) throw new Error('Indicizzazione già in corso.');
      }
      setState(this.db,'indexLock',{owner,pid:process.pid,expires:Date.now()+7200000});
    })();
    try { return await this.buildSnapshot(); }
    finally { if (state<{owner: string}>(this.db,'indexLock')?.owner === owner) this.db.prepare("DELETE FROM planner_state WHERE key='indexLock'").run(); }
  }
  private async buildSnapshot() {
    if (!this.vectors) throw new Error('Modello embedding non disponibile.');
    const input = this.db.transaction(() => capture(this.db))();
    const docs = documentsFor(input);
    const id = createHash('sha256').update(stringify({ input, docs, model: this.vectors.identity,indexVersion:'full-buckets-v2' })).digest('hex');
    const workspace = `riciclo-${id}`;
    const current = activeSnapshot(this.db);
    if (current?.id === id) { setState(this.db, 'ragDirty', false); return current; }
    // Failed attempts never overwrite the active pointer. Remove any incomplete previous attempt.
    try {
      await this.vectors.closeWorkspace(workspace, true).catch(() => {});
      const ids = await this.vectors.save(workspace, docs);
      if (ids.length !== docs.length || new Set(ids).size !== ids.length) throw new Error('ID vettoriali incompleti o duplicati.');
      if(docs.length>=16) await this.vectors.reindex?.(workspace);
      const probe = await this.vectors.search(workspace, 'popolazione Crocetta', 40);
      const expected=docs.find(d=>d.id.startsWith(`neighborhood:${input.neighborhoods.find(q=>q.name==='Crocetta')?.id}:population`));
      if (!probe.length || !probe.every(r => ids.includes(r.id)) || expected && !probe.some(r=>r.id===ids[docs.indexOf(expected)])) throw new Error('Verifica indice fallita.');
      await this.vectors.closeWorkspace(workspace);
      this.db.transaction(() => {
        this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)').run(id, workspace, stringify(input), new Date().toISOString());
        this.db.prepare('DELETE FROM evidence WHERE snapshot=?').run(id);
        const insert = this.db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?)');
        docs.forEach((d, i) => insert.run(id, d.id, d.content, d.areaId, d.year, d.period?.from ?? null, d.period?.to ?? null, stringify(d.sources), ids[i]));
        const fingerprint=(value:Input)=>stringify({...value,sync:value.sync?{...value.sync,updatedAt:undefined,latestBlock:undefined}:null});
        const changed=fingerprint(capture(this.db))!==fingerprint(input);
        setState(this.db, 'activeSnapshot', id); setState(this.db, 'ragDirty', changed);
      })();
      return { id, workspace, payload: input };
    } catch (error) {
      await this.vectors.closeWorkspace(workspace, true).catch(() => {});
      throw error;
    }
  }
  async search(snapshot: Snapshot, query: string, areaId?: string, year?: number, period?: { from: number; to: number } | null) {
    if (!this.vectors) throw new Error('RAG non pronto.');
    const matches: any[] = [];
    for (const topK of [12, 40]) {
      const hits = await this.vectors.search(snapshot.workspace, query, topK);
      for (const hit of hits) {
        const doc = this.db.prepare('SELECT * FROM evidence WHERE snapshot=? AND vector_id=?').get(snapshot.id, hit.id) as any;
        if (!doc || matches.some(d => d.id === doc.id)) continue;
        if (areaId && doc.area_id !== null && doc.area_id !== areaId) continue;
        if (year && doc.year !== year) continue;
        if (doc.period_from !== null && (!period || period.from !== doc.period_from || period.to !== doc.period_to)) continue;
        matches.push({ id: doc.id, content: doc.content, areaId: doc.area_id, year: doc.year, sources: JSON.parse(doc.sources) });
        if (matches.length === 6) break;
      }
      if (matches.length >= 6) break;
    }
    return matches.slice(0, 6);
  }
}
