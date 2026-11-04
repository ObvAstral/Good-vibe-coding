import { arch, platform } from 'node:os';

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 17)) {
    throw new Error('Serve Node.js >=22.17.');
  }
  console.log(`Node ${process.version} · ${platform()}/${arch()}`);
  const { sdk } = await import('../src/sdk.js');
  try {
    await sdk.heartbeat();
    console.log('SDK importato e worker Bare operativo.');
  } finally {
    await sdk.close();
  }
} catch (error) {
  console.error('Verifica QVAC fallita:', error.message);
  console.error('Esegui npm install e riprova. Per verificare anche il modello: npm run smoke.');
  process.exitCode = 1;
}
