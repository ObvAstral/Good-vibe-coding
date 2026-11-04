import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDB } from './helpers.js';
import { Provider } from '../src/provider.js';
test('assenza chiave e budget impediscono chiamate; errori auth non riprovati', async () => {
  const db = testDB(); let calls = 0;
  const fetcher = (async () => { calls++; return new Response('{}', { status: 401 }); }) as typeof fetch;
  try {
    await assert.rejects(new Provider(db, { fetcher }).complete([], []), /Chiave/);
    await assert.rejects(new Provider(db, { apiKey: 'test', budget: 0, fetcher }).complete([], []), /Budget/);
    assert.equal(calls, 0);
    await assert.rejects(new Provider(db, { apiKey: 'test', fetcher }).complete([], []), /Autenticazione/);
    assert.equal(calls, 1);
  } finally { db.close(); }
});
test('retry transitorio una sola volta, conteggio token e nessun reasoning', async () => {
  const db = testDB(); let calls = 0;
  const fetcher = (async (_url, options) => {
    calls++; const body = JSON.parse(options!.body as string);
    assert.equal(body.thinking.type, 'disabled'); assert.equal(body.max_tokens, 1000);
    if (calls === 1) return new Response('{}', { status: 503 });
    return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: 'ok' } }] });
  }) as typeof fetch;
  try {
    assert.equal((await new Provider(db, { apiKey: 'test', fetcher }).complete([], [])).content, 'ok');
    assert.equal(calls, 2);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM ai_calls WHERE status='completed'").get() as any).n, 1);
    assert.ok((db.prepare('SELECT SUM(cost) cost FROM ai_calls').get() as any).cost > 0);
  } finally { db.close(); }
});
