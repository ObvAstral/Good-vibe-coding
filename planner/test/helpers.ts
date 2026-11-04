import { openDB } from '../src/db.js';
import type { Input } from '../src/analytics.js';
import type { Document, VectorStore } from '../src/rag.js';
export function testDB() {
  const db = openDB(':memory:');
  db.exec(`CREATE TABLE dataset_sources(sha256 TEXT,url TEXT,filename TEXT);
    CREATE TABLE demographics(kind TEXT,area_id TEXT,name TEXT,population INTEGER,geographic INTEGER,year INTEGER,source_sha256 TEXT);
    CREATE TABLE zone_neighborhoods(zone_id TEXT,neighborhood_id TEXT,overlap_share REAL);
    CREATE TABLE social_indicators(zone_id TEXT,idise REAL,year INTEGER,source_sha256 TEXT);
    INSERT INTO dataset_sources VALUES ('demo','https://example.org/data','fixture.csv');`);
  for (let n = 1; n <= 4; n++) {
    const name = ['Crocetta', 'Pozzo Strada', 'Aurora', 'Santa Rita'][n - 1];
    db.prepare('INSERT INTO demographics VALUES (?,?,?,?,?,?,?)').run('neighborhood', String(n), name, n * 1000, 1, 2025, 'demo');
    db.prepare('INSERT INTO demographics VALUES (?,?,?,?,?,?,?)').run('zone', String(n), name, n * 1000, 1, 2025, 'demo');
    db.prepare('INSERT INTO zone_neighborhoods VALUES (?,?,1)').run(String(n), String(n));
    db.prepare('INSERT INTO social_indicators VALUES (?,?,2023,?)').run(String(n), 95 + n, 'demo');
  }
  return db;
}
export class MemoryVectors implements VectorStore {
  identity = 'test-only';
  workspaces = new Map<string, Document[]>();
  fail = false;
  async save(workspace: string, docs: Document[]) {
    if (this.fail) throw new Error('failure');
    this.workspaces.set(workspace, docs); return docs.map(d => d.id);
  }
  async search(workspace: string, _query: string, topK: number) {
    return (this.workspaces.get(workspace) ?? []).slice(0, topK).map(d => ({ id: d.id, content: d.content, score: 1 }));
  }
  async closeWorkspace(workspace: string, remove = false) { if (remove) this.workspaces.delete(workspace); }
  async close() {}
}
export function addHistory(input: Input): Input {
  const day = 86400;
  return { ...input, sync: { deployment: 'test', indexedBlock: 50, blockHash: 'hash', timestamp: day * 100, latestBlock: 52, updatedAt: 'test', simulated: true },
    locations: [{ point_id: '1', zone_id: '1', neighborhood_id: '1' }, { point_id: '2', zone_id: '2', neighborhood_id: '2' }],
    events: [
      { event: 'PointRegistered', timestamp: day * 40, block_number: 1, log_index: 0, args: { pointId: '1', kind: 0 } },
      { event: 'PointRegistered', timestamp: day * 40, block_number: 2, log_index: 0, args: { pointId: '2', kind: 0 } },
      ...[0, 1, 2].map(n => ({ event: 'BottlesDeposited', timestamp: day * (75 + n), block_number: 3 + n, log_index: 0,
        args: { machineId: '1', recipient: 'same-wallet', bottles: '10', minted: '10' } })),
      { event: 'PointStatusChanged', timestamp: day * 85, block_number: 6, log_index: 0, args: { pointId: '1', active: false } },
    ] };
}
