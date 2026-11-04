import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDB, MemoryVectors } from './helpers.js';
import { Retrieval, activeSnapshot, documentsFor } from '../src/rag.js';
import { capture } from '../src/analytics.js';
import {state} from '../src/db.js';
test('snapshot versionato, filtri territoriali e anno, fallimento conserva indice precedente', async () => {
  const db = testDB(), vectors = new MemoryVectors(), rag = new Retrieval(db, vectors);
  try {
    const first = await rag.build();
    assert.equal((await rag.build()).id, first.id);
    const filtered = await rag.search(first, 'reddito', '2', 2023);
    assert.ok(filtered.length); assert.ok(filtered.every(d => d.areaId === '2' && d.year === 2023));
    db.prepare("UPDATE social_indicators SET idise=110 WHERE zone_id='1'").run();
    vectors.fail = true;
    await assert.rejects(rag.build()); assert.equal(activeSnapshot(db)!.id, first.id);
    vectors.fail = false;
    const next = await rag.build(); assert.notEqual(next.id, first.id);
    assert.equal(activeSnapshot(db)!.id, next.id);
  } finally { db.close(); }
});
test('schede senza wallet, chunk limitati e ID stabili', () => {
  const db = testDB();
  try {
    const input = capture(db); input.context = [{ id: 'long', year: 2023, source: 'dataset:demo', content: 'metodologia '.repeat(500) },
      {id:'same-1',year:2023,source:'source1',content:'Frase identica ripetuta nel PDF.'},
      {id:'same-2',year:2023,source:'source2',content:'Frase identica ripetuta nel PDF.'}];
    const docs = documentsFor(input);
    assert.ok(docs.every(d => Buffer.byteLength(d.content) <= 1200));
    assert.equal(new Set(docs.map(d => d.id)).size, docs.length);
    assert.deepEqual(docs, documentsFor(input));
    assert.equal(new Set(docs.map(d=>d.content)).size,docs.length);
    assert.deepEqual(docs.find(d=>d.content.includes('Frase identica'))!.sources,['source1','source2']);
  } finally { db.close(); }
});
test('due indicizzazioni concorrenti non possono costruire lo stesso workspace', async () => {
  const db = testDB(), vectors = new MemoryVectors(), rag = new Retrieval(db, vectors);
  try {
    const first = rag.build();
    await assert.rejects(rag.build(), /già in corso/);
    await first;
    assert.ok(await rag.build());
  } finally { db.close(); }
});
test('dati modificati durante ingest restano segnalati come nuovi, senza mescolare lo snapshot',async()=>{
 const db=testDB(),vectors=new MemoryVectors(),rag=new Retrieval(db,vectors);
 const save=vectors.save.bind(vectors);
 vectors.save=async(w,docs)=>{db.prepare("UPDATE demographics SET population=12345 WHERE kind='neighborhood' AND area_id='1'").run();return save(w,docs);};
 try{
  const snapshot=await rag.build();
  assert.equal(snapshot.payload.neighborhoods.find(q=>q.id==='1')!.population,1000);
  assert.equal(state(db,'ragDirty'),true);
 }finally{db.close();}
});
