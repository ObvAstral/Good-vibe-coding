import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NEIGHBORHOODS} from '../../shared/src/geography.js';
import {testDB} from './helpers.js';
import {importHistory} from '../src/history.js';
import {capture,usage,usageReport,trends,defaultPeriod,recommendations} from '../src/analytics.js';
import {documentsFor} from '../src/rag.js';
const path='data/simulated/history-v1';
test('pacchetto collega: ricevute, totali, quartieri, periodi, esposizione e corpus separato dalle domande',()=>{
 const db=testDB();
 try {
  db.exec('DELETE FROM demographics;DELETE FROM zone_neighborhoods;DELETE FROM social_indicators;');
  for(const q of NEIGHBORHOODS){
   db.prepare('INSERT INTO demographics VALUES (?,?,?,?,?,?,?)').run('neighborhood',String(q.id),q.name,1000,1,2025,'demo');
   db.prepare('INSERT INTO demographics VALUES (?,?,?,?,?,?,?)').run('zone',String(q.id),q.name,1000,1,2025,'demo');
   db.prepare('INSERT INTO zone_neighborhoods VALUES (?,?,1)').run(String(q.id),String(q.id));
   db.prepare('INSERT INTO social_indicators VALUES (?,?,2023,?)').run(String(q.id),100+q.id,'demo');
  }
  const imported=importHistory(db,path);
  assert.deepEqual(imported,importHistory(db,path));
  const input=capture(db), p={from:imported.periodFrom!,to:imported.periodTo!};
  const total=usage(input,p);
  const expected=JSON.parse(readFileSync(`${path}/manifest.json`,'utf8')).total;
  for(const [key,value] of Object.entries(expected)) assert.equal(String((total as any)[key]),value);
  assert.equal(total.depositCount+total.purchaseCount,5000);
  const report=usageReport(input,p);
  assert.equal(report.totalDays,180);assert.equal(report.byDay.length,30);assert.equal(report.truncatedDays,true);
  assert.equal(report.totalPoints,16);assert.equal(report.byPoint.length,10);assert.equal(report.truncatedPoints,true);
  assert.equal(total.unlocatedOperations,0);
  assert.equal(usage(input,p,{neighborhoodId:'16'}).enabledPointDays,153);
  const aggregate=JSON.parse(readFileSync(`${path}/aggregates.json`,'utf8'));
  for(const row of aggregate.byNeighborhood){
   const actual=usage(input,p,{neighborhoodId:String(row.neighborhoodId)});
   for(const field of Object.keys(expected)) assert.equal(String((actual as any)[field]),row[field]);
  }
  const questions=JSON.parse(readFileSync(`${path}/evaluation-questions.json`,'utf8'));
  for(const id of ['Q10','Q12','Q14']){
   const e=questions.find((q:any)=>q.id===id).expected;
   const t=trends(input,String(e.neighborhoodId),defaultPeriod(input)) as any;
   for(const field of Object.keys(expected)){
    assert.equal(String(t.current[field]),e.latest[field]);
    assert.equal(String(t.previous[field]),e.previous[field]);
   }
  }
  const without=input.neighborhoods.filter(q=>usage(input,p,{neighborhoodId:q.id}).activeMachines===0 && usage(input,p,{neighborhoodId:q.id}).activeStores===0);
  assert.equal(without.length,13);
  const r=recommendations(input,defaultPeriod(input));
  assert.equal(r.expansion.length,10);assert.equal(r.pilot.length,13);
  assert.equal(r.top.filter(q=>q.category==='expansion').length,2);
  assert.equal(r.top.filter(q=>q.category==='pilot').length,1);
  assert.ok(r.top.every(q=>q.sources.length && q.idiseYear===2023));
  const docs=documentsFor(input);
  assert.ok(docs.some(d=>d.id.startsWith('history-v1:network')));
  assert.ok(!docs.some(d=>d.id.startsWith('Q01')));
  assert.ok(docs.every(d=>!/0x[0-9a-fA-F]{40}/.test(d.content)));
 }finally{db.close();}
});
