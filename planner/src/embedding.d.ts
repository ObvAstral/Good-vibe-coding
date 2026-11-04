export const projectRoot: string;
export const queryPrefix: string;
export function configurePlanner(env?: Record<string,string | undefined>): string;
export function fingerprintModel(path: string): Promise<string>;
export function validateVectors(vectors: number[][], count: number, dimensions?: number): number;
export function openEmbedding(): Promise<{sdk: typeof import('@qvac/sdk'); modelId: string; sha256: string; path: string}>;
