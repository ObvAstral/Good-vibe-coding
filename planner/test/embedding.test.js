import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { configurePlanner, fingerprintModel, validateVectors } from '../src/embedding.js';

test('planner requires a local model and resolves configuration independently of cwd', () => {
  assert.throws(() => configurePlanner({}), /obbligatorio/);
  const env = { QVAC_EMBEDDING_MODEL_PATH: '.qvac/model.gguf' };
  assert.ok(isAbsolute(configurePlanner(env)));
  assert.ok(env.QVAC_CONFIG_PATH.endsWith('/planner/qvac.config.js'));
});

test('invalid, empty, non-finite and inconsistent vectors are rejected', () => {
  assert.equal(validateVectors([[1, 2], [3, 4]], 2), 2);
  for (const vectors of [[], [[]], [[0, 0]], [[NaN, 1]], [[Infinity, 1]], [[1, 2], [3]]]) {
    assert.throws(() => validateVectors(vectors, vectors.length));
  }
  assert.throws(() => validateVectors([[1, 2]], 2));
  assert.throws(() => validateVectors([[1, 2]], 1, 3));
});

test('fingerprint rejects non-GGUF downloads and hashes the entire file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'planner-model-'));
  try {
    const path = join(directory, 'model.gguf');
    await writeFile(path, '<html>download failed</html>');
    await assert.rejects(fingerprintModel(path), /GGUF/);
    await writeFile(path, 'GGUFtest');
    const before = await fingerprintModel(path);
    await writeFile(path, 'GGUFchanged');
    assert.notEqual(await fingerprintModel(path), before);
  } finally {
    await rm(directory, { recursive: true });
  }
});
