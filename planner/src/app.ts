import Fastify from 'fastify';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { type DB, state } from './db.js';
import { Chat } from './chat.js';
import { periodFor, recommendations } from './analytics.js';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function createManager(db: DB, username: string, password: string) {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) || password.length < 12 || password.length > 200) throw new Error('Nome utente non valido o password sotto i 12 caratteri.');
  const salt = randomBytes(16).toString('hex');
  db.transaction(() => {
    for (const row of db.prepare('SELECT token_hash FROM sessions WHERE username=?').all(username) as {token_hash: string}[]) revoke(db, row.token_hash);
    db.prepare('INSERT INTO managers VALUES (?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash').run(username, salt, scryptSync(password, salt, 64).toString('hex'));
  })();
}
function revoke(db: DB, token: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE conversation IN (SELECT id FROM conversations WHERE session_hash=?)').run(token);
    db.prepare('DELETE FROM conversations WHERE session_hash=?').run(token);
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(token);
  })();
}
export function createPlannerApp(db: DB, chat: Chat) {
  const app = Fastify({ bodyLimit: 16384, logger: false, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const sessionFor = (cookie?: string) => hash(cookie?.split(';').find(c => c.trim().startsWith('planner_session='))?.trim().slice(16) ?? '');
  const limit = (key: string, count: number, interval = 60000) => db.transaction(() => {
    const now = Date.now();
    db.prepare('DELETE FROM request_limits WHERE timestamp<?').run(now - 86400000);
    const used = (db.prepare('SELECT COUNT(*) n FROM request_limits WHERE key=? AND timestamp>?').get(key, now - interval) as any).n;
    if (used >= count) return false;
    db.prepare('INSERT INTO request_limits VALUES (?,?)').run(key, now); return true;
  })();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin) {
      let host: string;
      try { host = new URL(request.headers.origin).host; } catch { return reply.code(403).send({ error: 'Origine non valida.' }); }
      if (host !== request.headers.host) return reply.code(403).send({ error: 'Origine non consentita.' });
    }
    if (request.method === 'POST' && request.url === '/api/session') return;
    const token = sessionFor(request.headers.cookie);
    const session = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(token, Date.now()) as any;
    if (!session) return reply.code(401).send({ error: 'Accesso richiesto.' });
    if (request.url === '/api/chat' && !limit(`chat:${session.username}`, 10)) return reply.code(429).send({ error: 'Limite di richieste raggiunto.' });
  });
  app.setErrorHandler((error: any, _request, reply) => reply.code(error.validation ? 400 : 503).send({ error: error.validation ? 'Richiesta non valida.' : error.message }));
  app.post<{ Body: { username: string; password: string } }>('/api/session', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['username', 'password'], properties: {
      username: { type: 'string', maxLength: 64 }, password: { type: 'string', maxLength: 200 } } } },
  }, async (request, reply) => {
    if (!limit(`login:${request.ip}`, 5)) return reply.code(429).send({ error: 'Troppi tentativi. Riprovare tra un minuto.' });
    const user = db.prepare('SELECT * FROM managers WHERE username=?').get(request.body.username) as any;
    const digest = scryptSync(request.body.password, user?.salt ?? 'dummy-salt', 64);
    if (!user || !timingSafeEqual(digest, Buffer.from(user.password_hash, 'hex'))) return reply.code(401).send({ error: 'Credenziali non valide.' });
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.username, Date.now() + 8 * 3600000);
    const previous = sessionFor(request.headers.cookie); if (previous !== hash('')) revoke(db, previous);
    reply.header('Set-Cookie', `planner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    return { username: user.username };
  });
  app.delete('/api/session', async (request, reply) => {
    revoke(db, sessionFor(request.headers.cookie));
    reply.header('Set-Cookie', 'planner_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });
  app.get('/api/planner/status', () => {
    const local = chat.local();
    return { username: undefined, sync: local.sync, latestSync: state(db, 'sync'), stale: local.stale, ragReady: local.ragReady,
      syncError: state(db, 'syncError'), aiConfigured: !!chat.provider.options.apiKey, neighborhoods: local.input.neighborhoods,
      cost: (db.prepare('SELECT COALESCE(SUM(cost),0) total FROM ai_calls').get() as any).total };
  });
  app.get<{ Querystring: { preference?: string; from?: string; to?: string } }>('/api/recommendations', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      preference: { type: 'string', enum: ['balanced', 'social', 'usage'] }, from: { type: 'string' }, to: { type: 'string' } } } },
  }, request => {
    const local = chat.local();
    if (!!request.query.from !== !!request.query.to) throw new Error('Specificare entrambe le date.');
    return { ...recommendations(local.input, periodFor(local.input, request.query.from ? { from: request.query.from, to: request.query.to! } : undefined), request.query.preference as any),
      stale: local.stale, ragReady: local.ragReady, sources: local.input.sources };
  });
  app.post<{ Body: { message: string; conversationId?: string; preference?: 'balanced'|'social'|'usage'; period?: {from:string;to:string} } }>('/api/chat', {
    schema: { body: { type: 'object', required: ['message'], additionalProperties: false, properties: {
      message: { type: 'string', minLength: 1, maxLength: 2000 }, conversationId: { type: 'string', format: 'uuid' },
      preference: {type:'string',enum:['balanced','social','usage']}, period: {type:'object',additionalProperties:false,required:['from','to'],properties:{from:{type:'string'},to:{type:'string'}}} } } },
  }, request => chat.answer(sessionFor(request.headers.cookie), request.body.message, request.body.conversationId,{preference:request.body.preference,period:request.body.period}));
  return app;
}
