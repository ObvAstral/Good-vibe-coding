import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {openDB} from '../src/db.js';
import {openVectors,Retrieval,activeSnapshot} from '../src/rag.js';
const db=openDB(), snapshot=activeSnapshot(db);
if(!snapshot) {db.close();throw new Error('Costruire prima un indice attivo: npm run planner:index.');}
const vectors=await openVectors(), rag=new Retrieval(db,vectors);
try{
 const checks=[];
 for(const name of ['Crocetta','Pozzo Strada','Centro','Aurora','Santa Rita','Parella','San Salvario']){
  const q=snapshot.payload.neighborhoods.find(q=>q.name===name)!;
  const hits=await rag.search(snapshot,`Quanti residenti ha ${name} nel 2025?`,q.id,2025,null);
  checks.push({query:`Popolazione ${name}`,passed:hits.some(d=>d.id.startsWith(`neighborhood:${q.id}:population`)) && hits.every(d=>(d.areaId===null || d.areaId===q.id) && d.year===2025),hits:hits.map(d=>d.id)});
 }
 for(const name of ['Crocetta','Pozzo Strada','Aurora','Santa Rita']){
  const q=snapshot.payload.neighborhoods.find(q=>q.name===name)!;
  const hits=await rag.search(snapshot,`IDISE e disagio socioeconomico nella sottozona di ${name}`,q.id,2023,null);
  checks.push({query:`IDISE ${name}`,passed:hits.some(d=>d.id.startsWith('zone:')) && hits.every(d=>(d.areaId===null || d.areaId===q.id) && d.year===2023),hits:hits.map(d=>d.id)});
 }
 for(const [query,area,from,to,expected] of [
  ['Andamento dei conferimenti in Aurora','7','2026-09-02','2026-10-31','history-v1:neighborhood:7:trend'],
  ['Andamento degli acquisti in Santa Rita','11','2026-09-02','2026-10-31','history-v1:neighborhood:11:trend'],
  ['Bottiglie e operazioni complessive nello storico',undefined,'2026-05-05','2026-10-31','history-v1:network'],
  ['Si possono sommare i wallet distinti dei singoli mesi?',undefined,'2026-05-05','2026-10-31','history-v1:methodology'],
 ] as const){
  const hits=await rag.search(snapshot,query,area,2026,{from:Date.parse(from)/1000,to:Date.parse(to)/1000+86400});
  checks.push({query,passed:hits.some(d=>d.id.startsWith(expected)),hits:hits.map(d=>d.id)});
 }
 mkdirSync('.data/planner',{recursive:true});
 writeFileSync('.data/planner/rag-real-verification.json',JSON.stringify({snapshot:snapshot.id,testedAt:new Date().toISOString(),passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2)+'\n');
 for(const c of checks) console.log(c.passed?'OK':'FAIL',c.query,c.hits.join(', '));
 assert.ok(checks.every(c=>c.passed),'Consultare .data/planner/rag-real-verification.json');
 console.log('Indice persistente riaperto in un nuovo processo, ricerca reale 15/15 verificata. Nessuna chiamata DeepSeek.');
}finally{await vectors.close();db.close();}
