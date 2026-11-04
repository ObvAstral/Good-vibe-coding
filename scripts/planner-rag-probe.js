import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openEmbedding, projectRoot, queryPrefix, validateVectors } from '../planner/src/embedding.js';

const fixtures = JSON.parse(await readFile(new URL('../planner/test/retrieval-fixtures.json', import.meta.url)));
const candidate = JSON.parse(await readFile(new URL('../planner/embedding-model.json', import.meta.url)));
const workspace = `riciclo-probe-${randomUUID()}`;
let runtime;
let workspaceCreated = false;
try {
  runtime = await openEmbedding();
  const { sdk, modelId, sha256 } = runtime;
  assert.equal(sha256, candidate.sha256, 'Il file non coincide con il candidato fissato nel manifest.');
  const { embedding } = await sdk.embed({ modelId, text: fixtures.map(f => f.content) });
  const dimensions = validateVectors(embedding, fixtures.length, candidate.dimensions);
  // Use ingest to exercise the SDK pipeline including droppedIndices and returned IDs.
  workspaceCreated = true;
  const ingest = await sdk.ragIngest({ modelId, workspace, documents: fixtures.map(f => f.content), chunk: false });
  assert.equal(ingest.droppedIndices.length, 0, 'Ingest incompleto.');
  assert.equal(ingest.processed.length, fixtures.length);
  assert.ok(ingest.processed.every(result => result.status === 'fulfilled'), 'Salvataggio incompleto.');
  await sdk.ragCloseWorkspace({ workspace });
  // Search must reopen the persisted workspace without another ingest.
  const results = [];
  for (const fixture of fixtures) {
    for (const query of fixture.queries) {
      const hits = await sdk.ragSearch({ modelId, workspace, query: queryPrefix + query, topK: 3 });
      const rank = hits.findIndex(hit => hit.content === fixture.content) + 1;
      results.push({ query, expected: fixture.id, rank, passed: rank > 0 && rank <= 3 });
      console.log(`${rank > 0 ? 'OK' : 'FAIL'} ${fixture.id} (rank ${rank}): ${query}`);
    }
  }
  const passed = results.filter(result => result.passed).length;
  const report = {
    testedAt: new Date().toISOString(), sdkVersion: '0.23.0', candidate,
    sha256, dimensions, queryPrefix, documentPrefix: '',
    syntheticFixtures: true, workspaceReopened: true, passed, total: results.length, results,
  };
  const directory = resolve(projectRoot, '.data/planner');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'embedding-probe.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(passed, results.length, 'Ricerca italiana non conforme: consultare .data/planner/embedding-probe.json.');
  console.log(`Embedding e retrieval verificati: ${passed}/${results.length}, ${dimensions} dimensioni.`);
} catch (error) {
  console.error('Verifica RAG fallita:', error.message);
  process.exitCode = 1;
} finally {
  if (runtime) {
    try {
      if (workspaceCreated) await runtime.sdk.ragCloseWorkspace({ workspace, deleteOnClose: true });
    } finally {
      try { await runtime.sdk.unloadModel({ modelId: runtime.modelId }); }
      finally { await runtime.sdk.close(); }
    }
  }
}
