import { usage, usageReport, trends, recommendations, periodFor, resolveArea, type Preference } from './analytics.js';
import { Retrieval, evidencePeriod, type Snapshot } from './rag.js';
const period = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } };
const str = { type: 'string' };
export const toolDefinitions = [
  ['get_usage', 'Conteggi e utilizzo della rete; sempre usare questo strumento per numeri operativi.', { period, pointId: str, neighborhoodId: str }, []],
  ['compare_areas', 'Confronta quartieri per nome o ID, senza aggregare impropriamente IDISE.', { areaIds: { type: 'array', items: str, minItems: 2, maxItems: 4 }, period }, ['areaIds']],
  ['get_trends', 'Confronta un quartiere con il periodo precedente della stessa durata.', { areaId: str, period }, ['areaId']],
  ['recommend_locations', 'Calcola la graduatoria su tutti i candidati, con priorità esplicita.', { period, preference: { type: 'string', enum: ['balanced', 'social', 'usage'] } }, []],
  ['search_evidence', 'Recupera fonti e schede filtrate. Specificare period per l’intero storico; i trend includono anche il periodo precedente.', { query: { type: 'string', maxLength: 2000 }, areaId: str, year: { type: 'integer' },period }, ['query']],
].map(([name, description, properties, required]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }));
export async function executeTool(rag: Retrieval, snapshot: Snapshot, name: string, args: any) {
  const definition = toolDefinitions.find(t => t.function.name === name);
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Strumento o argomenti non validi.');
  const properties = definition.function.parameters.properties as Record<string, any>;
  if (Object.keys(args).some(k => !Object.hasOwn(properties,k)) || (definition.function.parameters.required as string[]).some(k => !Object.hasOwn(args,k))) throw new Error('Argomenti inattesi o mancanti.');
  for (const [key, value] of Object.entries(args)) {
    const type = properties[key].type;
    if (type === 'string' && (typeof value !== 'string' || value.length > 2000)) throw new Error('Testo non valido.');
    if (type === 'integer' && !Number.isInteger(value)) throw new Error('Anno non valido.');
    if (type === 'array' && (!Array.isArray(value) || value.length < 2 || value.length > 4 || !value.every(v => typeof v === 'string'))) throw new Error('Elenco quartieri non valido.');
  }
  if ('period' in args && (!args.period || Array.isArray(args.period) || typeof args.period !== 'object' || Object.keys(args.period).sort().join(',') !== 'from,to' || typeof args.period.from !== 'string' || typeof args.period.to !== 'string')) throw new Error('Periodo non valido.');
  const input = snapshot.payload, p = periodFor(input, args.period);
  const area = (value: string) => resolveArea(input, value).id;
  const observed = () => ({ indexedBlock: input.sync?.indexedBlock ?? null, period: p, simulated: !!input.sync, sources: ['chain:hardhat'] });
  switch (name) {
    case 'get_usage':
      if (args.pointId && !/^[1-9][0-9]*$/.test(args.pointId)) throw new Error('pointId non valido.');
      return { ...observed(), ...usageReport(input, p, { pointId: args.pointId, neighborhoodId: args.neighborhoodId ? area(args.neighborhoodId) : undefined }) };
    case 'compare_areas': return { ...observed(), areas: args.areaIds.map((id: string) => {
      const q = resolveArea(input, id);
      return { ...q, usage: usage(input, p, { neighborhoodId: q.id }), potentialFoodPartners: {
        count: input.potentialPartners.filter(r => input.zones.some(z => z.id === r.zoneId && z.neighborhoodId === q.id)).reduce((sum,r) => sum+r.count,0),
        source: input.sources.find(s => s.file === 'attivita_commerciali_geo.zip')?.id,
        limitation:'Record di partner potenziali; non affiliazioni o aperture attuali verificate.'},
        socialEvidence: input.zones.filter(z => z.neighborhoodId === q.id).map(z => ({ zone: z.name, idise: z.idise, year: 2023, sources: [z.socialSource] })) };
    }) };
    case 'get_trends': return { ...observed(), ...trends(input, args.areaId, p) };
    case 'recommend_locations': {
      const result = recommendations(input, p, (args.preference ?? 'balanced') as Preference);
      // The engine evaluates all zones. Send a compact ranking, retaining full values in structured UI results.
      return { ...result, candidates: undefined, expansion: result.expansion.map(r => ({ neighborhood: r.neighborhood, score: r.score })), pilot: result.pilot.map(r => ({ neighborhood: r.neighborhood, score: r.score })) };
    }
    case 'search_evidence': return { evidence: await rag.search(snapshot, args.query, args.areaId ? area(args.areaId) : undefined, args.year, evidencePeriod(args.query,p)) };
  }
  throw new Error('Strumento sconosciuto.');
}
