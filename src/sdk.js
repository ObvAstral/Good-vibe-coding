import { fileURLToPath } from 'node:url';

// Resolve configuration from this project even when imported from another cwd.
process.env.QVAC_CONFIG_PATH ??= fileURLToPath(new URL('../qvac.config.json', import.meta.url));
export const sdk = await import('@qvac/sdk');
