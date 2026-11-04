import { fileURLToPath } from 'node:url';

export default {
  plugins: ['@qvac/sdk/llamacpp-embedding/plugin'],
  cacheDirectory: fileURLToPath(new URL('../.qvac/planner/models', import.meta.url)),
  loggerConsoleOutput: false,
  rpcInitTimeoutMs: 120000,
  httpConnectionTimeoutMs: 15000,
  httpDownloadConcurrency: 1,
};
