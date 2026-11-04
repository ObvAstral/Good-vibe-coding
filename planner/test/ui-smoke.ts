import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { openDB } from '../src/db.js';
import { createManager, createPlannerApp } from '../src/app.js';
import { Chat } from '../src/chat.js';
import { Provider } from '../src/provider.js';
import { Retrieval } from '../src/rag.js';
import { stopChild } from '../../scripts/local-chain.js';
const directory = await mkdtemp(join(tmpdir(), 'planner-ui-'));
const source = openDB();
await source.backup(join(directory, 'test.sqlite')); source.close();
const db = openDB(join(directory, 'test.sqlite'));
createManager(db, 'qa-gestore', 'qa-password-lunga');
const app = createPlannerApp(db, new Chat(db, new Retrieval(db, null), new Provider(db)));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts', '--host', '127.0.0.1', '--port', '18550', 'web'], {
  env: { ...process.env, PLANNER_PROXY_TARGET: address }, stdio: 'ignore',
});
let browser;
try {
  let ready = false;
  for (let n = 0; n < 150; n++) {
    try { if ((await fetch('http://127.0.0.1:18550/gestione/chat')).ok) { ready = true; break; } } catch {}
    if (vite.exitCode !== null) throw new Error('Vite non avviato.');
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Vite non pronto');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:18550/gestione/chat');
  await page.getByLabel('Nome utente').fill('qa-gestore'); await page.getByLabel('Password', { exact: true }).fill('qa-password-lunga');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('.planner-card').first().waitFor();
  assert.equal(await page.locator('.planner-card').count(), 3);
  await page.getByLabel('Priorità').selectOption('social');
  await page.getByLabel('La tua domanda').fill('Confronta Crocetta e Pozzo Strada');
  await page.getByRole('button', { name: 'Invia domanda' }).click();
  await page.getByText('La spiegazione AI non è disponibile. Consulta i risultati strutturati e le fonti.', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/planner-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/planner-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow su mobile');
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.getByRole('button', { name: 'Accedi', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser: login, proposte, priorità, fallback, mobile e logout verificati.');
} finally {
  await browser?.close(); await stopChild(vite); await app.close(); db.close(); await rm(directory, { recursive: true });
}
