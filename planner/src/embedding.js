import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import model from '../embedding-model.json' with { type: 'json' };

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const queryPrefix = model.queryPrefix;

export function configurePlanner(env = process.env) {
  env.QVAC_CONFIG_PATH = resolve(projectRoot, env.QVAC_CONFIG_PATH || 'planner/qvac.config.js');
  if (!env.QVAC_EMBEDDING_MODEL_PATH) {
    throw new Error('QVAC_EMBEDDING_MODEL_PATH obbligatorio: indicare un modello embedding GGUF locale.');
  }
  return resolve(projectRoot, env.QVAC_EMBEDDING_MODEL_PATH);
}

export async function fingerprintModel(path) {
  const file = await open(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    await file.read(magic, 0, 4, 0);
    if (magic.toString('ascii') !== 'GGUF') throw new Error('Il modello non è un file GGUF.');
  } finally {
    await file.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function validateVectors(vectors, count, dimensions) {
  if (!Array.isArray(vectors) || vectors.length !== count) throw new Error('Numero di embedding incoerente.');
  const size = dimensions ?? vectors[0]?.length;
  if (!Number.isInteger(size) || size < 1) throw new Error('Embedding vuoto.');
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== size || !vector.every(Number.isFinite)
      || !vector.some(value => value !== 0)) throw new Error('Embedding non valido o dimensioni incoerenti.');
  }
  return size;
}

// The standalone planner must set its configuration before the first SDK import.
export async function openEmbedding() {
  const path = configurePlanner();
  const sha256 = await fingerprintModel(path);
  if (sha256 !== model.sha256) throw new Error('Checksum del modello diverso dal manifest embedding.');
  const sdk = await import('@qvac/sdk');
  let modelId;
  try {
    await sdk.heartbeat();
    modelId = await sdk.loadModel({
      modelSrc: path,
      modelType: 'llamacpp-embedding',
      modelConfig: { device: 'cpu', pooling: model.pooling, embdNormalize: 2 },
    });
    return { sdk, modelId, sha256, path };
  } catch (error) {
    await sdk.close();
    throw error;
  }
}
