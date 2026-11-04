import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

let sdk;
let modelId;
let terminal;
try {
  ({ sdk } = await import('./sdk.js'));
  const oneShot = process.argv.slice(2).join(' ').trim();
  console.error('Caricamento Llama 3.2 1B; al primo avvio viene scaricato il modello.');
  let lastPercent = -1;
  modelId = await sdk.loadModel({
    modelSrc: sdk.LLAMA_3_2_1B_INST_Q4_0,
    onProgress(progress) {
      const percent = Math.floor(progress.percentage);
      if (Number.isFinite(percent) && percent !== lastPercent && (percent % 10 === 0 || percent === 100)) {
        console.error(`Download: ${percent}%`);
        lastPercent = percent;
      }
    }
  });
  const history = [];
  async function ask(content) {
    history.push({ role: 'user', content });
    const result = sdk.completion({ modelId, history, stream: true });
    let answer = '';
    for await (const token of result.tokenStream) {
      answer += token;
      stdout.write(token);
    }
    stdout.write('\n');
    history.push({ role: 'assistant', content: answer });
  }
  if (oneShot) {
    await ask(oneShot);
  } else {
    terminal = createInterface({ input: stdin, output: stdout });
    console.log('Chat pronta. Scrivi /exit per uscire.');
    for await (const line of terminal) {
      const prompt = line.trim();
      if (prompt === '/exit') break;
      if (prompt) await ask(prompt);
    }
  }
} catch (error) {
  console.error('Errore QVAC:', error.message);
  process.exitCode = 1;
} finally {
  terminal?.close();
  if (sdk) {
    try {
      if (modelId !== undefined) await sdk.unloadModel({ modelId });
    } catch (error) {
      console.error('Scaricamento modello dalla memoria fallito:', error.message);
      process.exitCode = 1;
    } finally {
      await sdk.close();
    }
  }
}
