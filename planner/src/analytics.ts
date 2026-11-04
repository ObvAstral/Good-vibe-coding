import { state, type DB } from './db.js';
import type { SyncState } from './indexer.js';
export type Period = { from: number; to: number };
export type Preference = 'balanced' | 'social' | 'usage';
export type Area = { id: string; name: string; population: number; source: string };
export type Zone = Area & { neighborhoodId: string; idise: number | null; socialSource: string; overlap: number };
export type Event = { block_number: number; log_index: number; timestamp: number; event: string; args: Record<string, any> };
export type Location = { point_id: string; neighborhood_id: string | null; zone_id: string | null };
export type Input = { neighborhoods: Area[]; zones: Zone[]; events: Event[]; locations: Location[]; sync: SyncState | null; sources: { id: string; url: string; file: string }[]; context: { id: string; content: string; year: number; source: string }[]; potentialPartners: {zoneId: string; count: number}[]; historyDocuments?: {documentId:string;version:string;text:string;contentHash:string;metadata:{areaId:number|null;from?:string;to?:string;sourceFiles:string[]}}[] };
export function capture(db: DB): Input {
  const exists = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists('social_indicators')) throw new Error('Importare prima i dati: npm run analytics:import.');
  const sync = state<SyncState>(db, 'sync');
  const result: Input = {
    neighborhoods: db.prepare("SELECT area_id id,name,population,'dataset:'||source_sha256 source FROM demographics WHERE kind='neighborhood' AND geographic=1 AND year=2025 ORDER BY area_id").all() as Area[],
    zones: db.prepare(`SELECT d.area_id id,d.name,d.population,'dataset:'||d.source_sha256 source,
      m.neighborhood_id neighborhoodId,s.idise,'dataset:'||s.source_sha256 socialSource,m.overlap_share overlap
      FROM demographics d JOIN zone_neighborhoods m ON m.zone_id=d.area_id
      JOIN social_indicators s ON s.zone_id=d.area_id AND s.year=2023
      WHERE d.kind='zone' AND d.geographic=1 AND d.year=2025 ORDER BY d.area_id`).all() as Zone[],
    events: (db.prepare('SELECT * FROM chain_logs ORDER BY block_number,log_index').all() as any[]).map(r => ({ ...r, args: JSON.parse(r.args) })),
    locations: sync ? db.prepare('SELECT * FROM point_locations WHERE deployment=?').all(sync.deployment) as Location[] : [],
    sync,
    sources: (db.prepare('SELECT sha256,url,filename FROM dataset_sources').all() as any[]).map(r => ({ id: `dataset:${r.sha256}`, url: r.url, file: r.filename })),
    context: exists('context_evidence') ? db.prepare('SELECT * FROM context_evidence ORDER BY id').all() as Input['context'] : [],
    potentialPartners: exists('potential_partners') ? db.prepare('SELECT zone_id zoneId,COUNT(*) count FROM potential_partners GROUP BY zone_id ORDER BY zone_id').all() as Input['potentialPartners'] : [],
  };
  // Protocol 3 defines the neighborhood on-chain; coordinates must not override it.
  for (const event of result.events) if (event.event === 'PointRegistered' && event.args.neighborhoodId !== undefined) {
    const id=String(event.args.pointId), q=String(event.args.neighborhoodId);
    if (!result.neighborhoods.some(n=>n.id===q)) throw new Error('Quartiere on-chain sconosciuto.');
    const old=result.locations.find(p=>p.point_id===id);
    if (old) old.neighborhood_id=q;
    else result.locations.push({point_id:id,neighborhood_id:q,zone_id:null});
  }
  if (sync?.source==='history') result.historyDocuments=state(db,'historyDocuments') ?? [];
  result.sources.push({id:'chain:hardhat',url:'/api/planner/status',file:sync?.source==='history'?'Storico simulato history-v1':'Eventi Hardhat locali'});
  return result;
}
export function defaultPeriod(input: Input): Period | null {
  if (!input.sync) return null;
  const to = Math.floor(input.sync.timestamp / 86400) * 86400;
  return { from: to - 30 * 86400, to };
}
export function periodFor(input: Input, requested?: { from: string; to: string }): Period | null {
  if (!requested) return defaultPeriod(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested.from) || !/^\d{4}-\d{2}-\d{2}$/.test(requested.to)) throw new Error('Usare date YYYY-MM-DD.');
  const from = Date.parse(requested.from) / 1000, to = Date.parse(requested.to) / 1000 + 86400;
  if (!Number.isFinite(from + to) || new Date(from * 1000).toISOString().slice(0,10) !== requested.from || new Date((to-86400)*1000).toISOString().slice(0,10) !== requested.to) throw new Error('Data non valida.');
  if (!Number.isFinite(from + to) || to <= from || to - from > 366 * 86400 || !input.sync || to > input.sync.timestamp) throw new Error('Periodo non disponibile o non valido.');
  return { from, to };
}
export function resolveArea(input: Input, value: string) {
  const normalize = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const matches = input.neighborhoods.filter(a => a.id === value || normalize(a.name) === normalize(value));
  if (matches.length !== 1) throw new Error(`Quartiere non riconosciuto: ${value}. Chiedere un chiarimento.`);
  return matches[0];
}
function pointState(input: Input, p: Period) {
  const points = new Map<string, { kind: number; active: boolean; since: number; days: number }>();
  for (const e of input.events) {
    if (e.timestamp >= p.to) break;
    const id = String(e.args.pointId);
    if (e.event === 'PointRegistered') points.set(id, { kind: Number(e.args.kind), active: true, since: e.timestamp, days: 0 });
    if (e.event === 'PointStatusChanged') {
      const point = points.get(id);
      if (!point) continue;
      if (point.active) point.days += Math.max(0, e.timestamp - Math.max(p.from, point.since)) / 86400;
      point.active = e.args.active === true; point.since = e.timestamp;
    }
  }
  for (const point of points.values()) if (point.active) point.days += Math.max(0, p.to - Math.max(p.from, point.since)) / 86400;
  return points;
}
export function usage(input: Input, period: Period | null, filter: { pointId?: string; neighborhoodId?: string; zoneId?: string } = {}) {
  const locations = new Map(input.locations.map(l => [l.point_id, l]));
  const selected = (id: string) => (!filter.pointId || id === filter.pointId)
    && (!filter.neighborhoodId || locations.get(id)?.neighborhood_id === filter.neighborhoodId)
    && (!filter.zoneId || locations.get(id)?.zone_id === filter.zoneId);
  let depositCount = 0, purchaseCount = 0, bottles = 0n, minted = 0n, burned = 0n, unlocated = 0;
  const deposits = new Set<string>(), purchases = new Set<string>();
  if (period) for (const e of input.events) {
    if (e.timestamp < period.from || e.timestamp >= period.to) continue;
    if (!['BottlesDeposited', 'PurchaseCompleted'].includes(e.event)) continue;
    const id = String(e.args.machineId ?? e.args.storeId);
    if (!selected(id)) continue;
    if (!locations.get(id)?.neighborhood_id) unlocated++;
    if (e.event === 'BottlesDeposited') {
      depositCount++; bottles += BigInt(e.args.bottles); minted += BigInt(e.args.minted); deposits.add(String(e.args.recipient).toLowerCase());
    } else { purchaseCount++; burned += BigInt(e.args.burned); purchases.add(String(e.args.buyer).toLowerCase()); }
  }
  let enabledPointDays = 0, activeMachines = 0, activeStores = 0;
  if (period) for (const [id, point] of pointState(input, period)) if (selected(id)) {
    if (point.kind === 0) { enabledPointDays += point.days; if (point.active) activeMachines++; }
    else if (point.active) activeStores++;
  }
  const start = input.sync?.deploymentTimestamp ?? input.events[0]?.timestamp ?? input.sync?.timestamp;
  const available = !!period && !!input.sync && start !== undefined && period.to > start;
  return { available, completeObservation: available && period!.from >= start!, observationFrom: available ? Math.max(period!.from,start!) : null,
    depositCount, purchaseCount, bottlesCollected: String(bottles), tokensMinted: String(minted), tokensBurned: String(burned),
    distinctDepositWallets: deposits.size, distinctPurchaseWallets: purchases.size, enabledPointDays,
    activeMachines: available ? activeMachines : null, activeStores: available ? activeStores : null,
    utilization: available && enabledPointDays >= 14 ? depositCount / enabledPointDays : null, unlocatedOperations: unlocated, period, simulated: !!input.sync };
}
export function trends(input: Input, areaId: string, p: Period | null) {
  const area = resolveArea(input, areaId);
  if (!p) return { area, available: false, reason: 'Storico non disponibile.' };
  const current = usage(input, p, { neighborhoodId: area.id }), previous = usage(input, { from: p.from - (p.to - p.from), to: p.from }, { neighborhoodId: area.id });
  return { area, available: current.available && previous.available, current, previous,
    depositChange: current.available && previous.available ? current.depositCount - previous.depositCount : null,
    percentChange: current.available && previous.completeObservation && previous.depositCount ? 100 * (current.depositCount - previous.depositCount) / previous.depositCount : null };
}
export function usageReport(input: Input, p: Period | null, filter: {pointId?: string; neighborhoodId?: string} = {}) {
  const total = usage(input,p,filter);
  const points = input.events.filter(e => e.event === 'PointRegistered').map(e => ({id:String(e.args.pointId),kind:Number(e.args.kind)}))
    .filter(p => (!filter.pointId || p.id === filter.pointId) && (!filter.neighborhoodId || input.locations.some(l => l.point_id === p.id && l.neighborhood_id === filter.neighborhoodId)));
  const byPoint = points.map(point => {
    const u = usage(input,p,{...filter,pointId:point.id});
    const location = input.locations.find(l => l.point_id === point.id);
    return {pointId:point.id,kind:point.kind === 0 ? 'machine' : 'store',neighborhood:input.neighborhoods.find(q => q.id === location?.neighborhood_id)?.name ?? null,
      depositCount:u.depositCount,purchaseCount:u.purchaseCount,bottlesCollected:u.bottlesCollected,tokensBurned:u.tokensBurned,enabledPointDays:u.enabledPointDays};
  }).sort((a,b) => b.depositCount-a.depositCount || b.purchaseCount-a.purchaseCount || a.pointId.localeCompare(b.pointId));
  const byDay = [];
  if (p && total.available) for (let from=p.from;from<p.to;from+=86400) {
    const u = usage(input,{from,to:Math.min(from+86400,p.to)},filter);
    byDay.push({day:new Date(from*1000).toISOString().slice(0,10),depositCount:u.depositCount,purchaseCount:u.purchaseCount,bottlesCollected:u.bottlesCollected,tokensBurned:u.tokensBurned});
  }
  return {...total,byPoint:byPoint.slice(0,10),totalPoints:byPoint.length,truncatedPoints:byPoint.length>10,byDay:byDay.slice(-30),truncatedDays:byDay.length>30,totalDays:byDay.length};
}
export function percentiles(values: number[]) {
  if (values.length === 1) return [50];
  return values.map(v => values.length < 2 ? 50 : 100 * (values.filter(x => x < v).length + (values.filter(x => x === v).length - 1) / 2) / (values.length - 1));
}
export function recommendations(input: Input, period: Period | null, preference: Preference = 'balanced') {
  if (!['balanced', 'social', 'usage'].includes(preference)) throw new Error('Priorità non valida.');
  const weights = { balanced: [0.5, 0.5], social: [0.75, 0.25], usage: [0.25, 0.75] }[preference];
  // Public unit is the neighborhood; neighborhood events do not imply zone-level usage.
  const base = input.neighborhoods.flatMap(q=>{
    const zone=input.zones.filter(z=>z.neighborhoodId===q.id && z.idise!==null && z.population>0)
      .sort((a,b)=>b.idise!-a.idise! || a.id.localeCompare(b.id))[0];
    return zone ? [{zone,usage:usage(input,period,{neighborhoodId:q.id}),population:q.population}] : [];
  });
  const social = percentiles(base.map(r => r.zone.idise!));
  const gaps = period && usage(input,period).available ? percentiles(base.map(r => r.population / (1 + (r.usage.activeMachines ?? 0)))) : null;
  const observed = base.filter(r => r.usage.utilization !== null);
  const utilization = percentiles(observed.map(r => r.usage.utilization!));
  const candidates = base.map((row, i) => {
    const uIndex = observed.indexOf(row), u = uIndex < 0 ? null : utilization[uIndex];
    const b = gaps ? (social[i] + gaps[i]) / 2 : social[i];
    const neighborhood = input.neighborhoods.find(q => q.id === row.zone.neighborhoodId)!;
    return { neighborhoodId: neighborhood.id, neighborhood: neighborhood.name, population: neighborhood.population,
      zoneId: row.zone.id, zone: row.zone.name, category: u === null ? 'pilot' : 'expansion',
      score: u === null ? b : weights[0] * b + weights[1] * u,
      components: { social: social[i], coverage: gaps?.[i] ?? null, needCoverage: b, utilization: u },
      usage: row.usage, idise: row.zone.idise, idiseYear: 2023, populationYear: 2025, overlapShare: row.zone.overlap,
      sources: [row.zone.source, row.zone.socialSource],
      limitations: ['Punteggio di progetto del quartiere; evidenza sociale dalla sottozona con IDISE pubblicato più alto, non indice ufficiale dell’intero quartiere.',
        ...(row.zone.overlap < 0.99999 ? ['Abbinamento geografico approssimato.'] : []),
        ...(!period ? ['Storico assente: priorità sociale preliminare, copertura e utilizzo non valutabili.'] : []),
        ...(row.usage.activeStores === 0 ? ['Verificare la rete di negozi affiliati.'] : [])],
    };
  });
  const sort = (a: typeof candidates[number], b: typeof candidates[number]) => b.score - a.score || a.neighborhoodId.localeCompare(b.neighborhoodId) || a.zoneId.localeCompare(b.zoneId);
  const unique = (rows: typeof candidates) => [...new Map(rows.sort(sort).map(r => r.neighborhoodId).map(id => [id, rows.find(r => r.neighborhoodId === id)!])).values()];
  const expansion = unique(candidates.filter(c => c.category === 'expansion')), pilot = unique(candidates.filter(c => c.category === 'pilot'));
  const top: typeof candidates = [];
  const add = (rows: typeof candidates, limit: number) => { for (const r of rows) if (!top.some(x => x.neighborhoodId === r.neighborhoodId) && limit > 0 && top.length < 3) { top.push(r); limit--; } };
  add(expansion, 2); add(pilot, 1); add(expansion, 3); add(pilot, 3);
  return { preference, weights, weightsPercent:{needCoverage:weights[0]*100,utilization:weights[1]*100},needCoverageWeightsPercent:{social:50,coverage:50}, period, top, expansion, pilot, candidates,
    needsInvestigation: input.neighborhoods.filter(q => !base.some(r => r.zone.neighborhoodId === q.id)),
    simulated: !!input.sync, indexedBlock: input.sync?.indexedBlock ?? null,
    method: 'Percentili con rango medio; parità risolte per codice stabile. Categorie espansione e pilota separate.' };
}
