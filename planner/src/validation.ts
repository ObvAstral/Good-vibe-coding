import {stringify} from './db.js';
import {defaultPeriod,type Input,type Preference} from './analytics.js';
const tokens=(text:string)=>text.match(/\d+(?:[.,]\d+)*/g)??[];
export function unsupportedNumbers(text:string,source:unknown) {
  const known=new Set(tokens(stringify(source)));
  for(const value of [...known]) {
    const number=Number(value);
    if(!Number.isFinite(number) || Math.abs(number)>Number.MAX_SAFE_INTEGER) continue;
    // Formatting and decimal rounding preserve the backend value's meaning.
    for(let digits=0;digits<=8;digits++) {
      known.add(number.toFixed(digits).replace(/\.?0+$/,(match)=>match.startsWith('.')?'':match));
      known.add(number.toLocaleString('it-IT',{maximumFractionDigits:digits}));
      known.add(number.toLocaleString('en-US',{maximumFractionDigits:digits}));
    }
  }
  const prose=text.replace(/^\s*[1-3][.)]\s/gm,'');
  return tokens(prose).filter(n=>!known.has(n));
}
export function selectedPreference(message:string,selection?:Preference):Preference {
  if(/priorit[aà].{0,24}(?:social|bisogno)|bisogno sociale|profilo social|pi[uù] sociale/i.test(message)) return 'social';
  if(/priorit[aà].{0,24}(?:utilizzo|uso|usage)|profilo usage/i.test(message)) return 'usage';
  if(/equilibrat|balanced/i.test(message)) return 'balanced';
  return selection??'balanced';
}
export function selectedDates(message:string,input:Input,selection?:{from:string;to:string}) {
 const dates=message.match(/\b\d{4}-\d{2}-\d{2}\b/g);
 if(dates?.length===2) return {from:dates[0],to:dates[1]};
 const iso=(n:number)=>new Date(n*1000).toISOString().slice(0,10);
 if(input.sync?.periodFrom && input.sync.periodTo && /(?:intero|tutto|completo|complessivo).{0,30}storico|storico.{0,30}(?:intero|completo|complessivo)/i.test(message)) return {from:iso(input.sync.periodFrom),to:iso(input.sync.periodTo-1)};
 if(selection) return selection;
 const p=defaultPeriod(input);
 if(!p) return undefined;
 const last=message.match(/ultim[io]\s+(\d{1,3})\s+giorn/i);
 if(last && Number(last[1])>=1 && Number(last[1])<=366) return {from:iso(p.to-Number(last[1])*86400),to:iso(p.to-1)};
 return {from:iso(p.from),to:iso(p.to-1)};
}
