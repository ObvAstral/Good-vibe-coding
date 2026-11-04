import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { testDB, MemoryVectors } from './helpers.js';
import { Retrieval } from '../src/rag.js';
import { Provider } from '../src/provider.js';
import { Chat } from '../src/chat.js';
import { createManager, createPlannerApp } from '../src/app.js';

async function setup(fetcher?: typeof fetch) {
  const db = testDB(), vectors = new MemoryVectors(), rag = new Retrieval(db, vectors);
  await rag.build();
  const provider = new Provider(db, { ...(fetcher ? { apiKey: 'test-only' } : {}), fetcher });
  const chat = new Chat(db, rag, provider);
  createManager(db, 'gestore', 'password-test-lunga');
  const app = createPlannerApp(db, chat);
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { username: 'gestore', password: 'password-test-lunga' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  return { db, vectors, rag, chat, app, cookie };
}
test('accesso richiesto, cookie riservato, logout e fallback senza API key', async () => {
  const s = await setup();
  try {
    assert.equal((await s.app.inject('/api/recommendations')).statusCode, 401);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: 'Dove installare?' } })).json().aiAvailable, false);
    const ranking = await s.app.inject({ url: '/api/recommendations', headers: { cookie: s.cookie } });
    assert.equal(ranking.statusCode, 200); assert.equal(ranking.json().top.length, 3);
    assert.equal((await s.app.inject({ url: '/api/planner/status', headers: { cookie: s.cookie, origin: 'https://evil.example' } })).statusCode, 403);
    const token = s.cookie.split('=')[1];
    assert.ok(s.db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(createHash('sha256').update(token).digest('hex')));
    await s.app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: s.cookie } });
    assert.equal((await s.app.inject({ url: '/api/recommendations', headers: { cookie: s.cookie } })).statusCode, 401);
  } finally { await s.app.close(); s.db.close(); }
});
test('rate limit login/chat e schema del messaggio', async () => {
  const s = await setup();
  try {
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: 'x'.repeat(2001) } })).statusCode, 400);
    for (let i = 0; i < 10; i++) await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: 'Ciao' } });
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: 'Ciao' } })).statusCode, 429);
    for (let i = 0; i < 5; i++) await s.app.inject({ method: 'POST', url: '/api/session', payload: { username: 'none', password: 'bad' } });
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/session', payload: { username: 'none', password: 'bad' } })).statusCode, 429);
  } finally { await s.app.close(); s.db.close(); }
});

const questions = [
  ['Quanti conferimenti sono disponibili?', 'get_usage', {}],
  ['Quante bottiglie sono state raccolte?', 'get_usage', {}],
  ['Qual è il totale dei crediti emessi?', 'get_usage', {}],
  ['Quanto è stato speso nei negozi?', 'get_usage', {}],
  ['Quali sono i wallet distinti?', 'get_usage', {}],
  ['Confronta Crocetta e Pozzo Strada', 'compare_areas', { areaIds: ['Crocetta', 'Pozzo Strada'] }],
  ['Confronta Aurora e Santa Rita', 'compare_areas', { areaIds: ['3', '4'] }],
  ['Confronta due quartieri per popolazione', 'compare_areas', { areaIds: ['1', '2'] }],
  ['Mostra andamento di Crocetta', 'get_trends', { areaId: 'Crocetta' }],
  ['Crescita di Pozzo Strada?', 'get_trends', { areaId: '2' }],
  ['Calo dei conferimenti in Aurora?', 'get_trends', { areaId: 'Aurora' }],
  ['Dove installare un nuovo punto?', 'recommend_locations', {}],
  ['Raccomanda quartieri con priorità sociale', 'recommend_locations', { preference: 'social' }],
  ['Dove installare con priorità utilizzo?', 'recommend_locations', { preference: 'usage' }],
  ['Quali sono le proposte pilota?', 'recommend_locations', {}],
  ['Perché questo ranking?', 'recommend_locations', {}],
  ['Quali fonti abbiamo per il reddito?', 'search_evidence', { query: 'reddito', year: 2023 }],
  ['Come è misurato il disagio?', 'search_evidence', { query: 'disagio' }],
  ['Popolazione di Crocetta?', 'search_evidence', { query: 'popolazione', areaId: '1', year: 2025 }],
  ['Cosa significa IDISE non disponibile?', 'search_evidence', { query: 'IDISE' }],
] as const;
for (const [question, tool, args] of questions) test(`chat con provider simulato: ${question}`, async () => {
  let calls = 0;
  const fetcher = (async (_url, options) => {
    calls++;
    const body = JSON.parse(options!.body as string);
    const message = calls === 1 ? { content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
      : { content: JSON.stringify({ text: 'Consulta i risultati verificati e i loro limiti.', sourceIds: ['dataset:demo'], clarification: false }) };
    assert.ok(body.messages.every((m: any) => !m.content?.includes('password-test-lunga')));
    return Response.json({ usage: { prompt_tokens: 200, completion_tokens: 40 }, choices: [{ message }] });
  }) as typeof fetch;
  const s = await setup(fetcher);
  try {
    const response = await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: question } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().aiAvailable, true, response.json().reason);
    assert.equal(response.json().toolResults[0].tool, tool);
    const result = response.json().toolResults[0].result;
    if (tool === 'get_usage') { assert.equal(result.available, false); assert.equal(result.depositCount, 0); }
    if (tool === 'compare_areas') assert.equal(result.areas.length, 2);
    if (tool === 'get_trends') assert.equal(result.available, false);
    if (tool === 'recommend_locations') assert.equal(new Set(result.top.map((x: any) => x.neighborhoodId)).size, 3);
    if (tool === 'search_evidence') assert.ok(Array.isArray(result.evidence));
    assert.equal(calls, 2);
  } finally { await s.app.close(); s.db.close(); }
});
test('risposta con numero inventato rifiutata; conversazioni isolate tra sessioni', async () => {
  const fetcher = (async () => Response.json({ usage: { prompt_tokens: 100, completion_tokens: 30 }, choices: [{ message: { content: JSON.stringify({ text: 'Residenti 999999999.', sourceIds: ['dataset:demo'], clarification: false }) } }] })) as typeof fetch;
  const s = await setup(fetcher);
  try {
    const a = await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: s.cookie }, payload: { message: 'Residenti?' } });
    assert.equal(a.json().aiAvailable, false); assert.match(a.json().reason, /numeri/);
    const other = await s.app.inject({ method: 'POST', url: '/api/session', payload: { username: 'gestore', password: 'password-test-lunga' } });
    const b = await s.app.inject({ method: 'POST', url: '/api/chat', headers: { cookie: String(other.headers['set-cookie']).split(';')[0] }, payload: { message: 'Ciao', conversationId: a.json().conversationId } });
    assert.notEqual(b.statusCode, 200);
  } finally { await s.app.close(); s.db.close(); }
});
