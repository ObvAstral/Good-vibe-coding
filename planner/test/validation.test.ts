import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unsupportedNumbers,selectedPreference,selectedDates} from '../src/validation.js';
import {capture} from '../src/analytics.js';
import {testDB,addHistory} from './helpers.js';
test('formattazione italiana e arrotondamenti non diventano falsi numeri inventati',()=>{
 assert.deepEqual(unsupportedNumbers('47.911 bottiglie e punteggio 77,27.',{bottles:'47911',score:77.27272727272728}),[]);
 assert.deepEqual(unsupportedNumbers('47911 bottiglie e punteggio 77.27.',{bottles:'47911',score:77.27272727272728}),[]);
 assert.ok(unsupportedNumbers('999999999 bottiglie.',{bottles:'47911'}).length);
});
test('la priorità UI resta autorevole salvo una richiesta esplicita del gestore',()=>{
 assert.equal(selectedPreference('Dove installare nuovi bidoni?','balanced'),'balanced');
 assert.equal(selectedPreference('Usa la priorità sociale','balanced'),'social');
 assert.equal(selectedPreference('Dai priorità all’utilizzo','social'),'usage');
});
test('periodo predefinito determinato dal blocco, con override esplicito del gestore',()=>{
 const db=testDB();
 try{
  const input=addHistory(capture(db));
  assert.deepEqual(selectedDates('Dove installare?',input),{from:'1970-03-12',to:'1970-04-10'});
  assert.deepEqual(selectedDates('Confronta quartieri',input,{from:'1970-03-01',to:'1970-03-31'}),{from:'1970-03-01',to:'1970-03-31'});
  assert.deepEqual(selectedDates('Dal 1970-03-01 al 1970-03-15',input),{from:'1970-03-01',to:'1970-03-15'});
 }finally{db.close();}
});
