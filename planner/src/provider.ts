import { stringify, type DB } from './db.js';
export class AIUnavailable extends Error {}
export type ChatMessage = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Completion = { content: string | null; tool_calls?: ToolCall[] };
export type ProviderOptions = { apiKey?: string; model?: string; budget?: number; fetcher?: typeof fetch; inputPrice?: number; outputPrice?: number };
export class Provider {
  model: string;
  constructor(public db: DB, public options: ProviderOptions = {}) { this.model = options.model ?? 'deepseek-flash'; }
  async complete(messages: ChatMessage[], tools: unknown[], final = false): Promise<Completion> {
    if (!this.options.apiKey) throw new AIUnavailable('Chiave DeepSeek non configurata.');
    const inputPrice = this.options.inputPrice ?? (this.model === 'deepseek-flash' ? 0.30 : this.model === 'deepseek-v4-pro' ? 1.32 : NaN);
    const outputPrice = this.options.outputPrice ?? (this.model === 'deepseek-flash' ? 1.20 : this.model === 'deepseek-v4-pro' ? 3.96 : NaN);
    const budget = this.options.budget ?? 0.60;
    if (![inputPrice, outputPrice, budget].every(x => Number.isFinite(x) && x >= 0)) throw new AIUnavailable('Configurazione prezzi o budget non valida.');
    const body = { model: this.model, messages, tools, max_tokens: 1000, thinking: { type: 'disabled' },
      ...(final ? { tool_choice: 'none', response_format: { type: 'json_object' } } : {}) };
    const encoded = stringify(body);
    if (Buffer.byteLength(encoded) > 48000) throw new AIUnavailable('Contesto oltre il limite applicativo.');
    const upperInputTokens = Buffer.byteLength(encoded) + 100 * (messages.length + tools.length + 1);
    const maximum = (upperInputTokens * inputPrice + 1000 * outputPrice) / 1e6;
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = this.db.transaction(() => {
        const used = (this.db.prepare('SELECT COALESCE(SUM(cost),0) total FROM ai_calls').get() as any).total;
        if (used + maximum > budget) throw new AIUnavailable('Budget AI esaurito.');
        return this.db.prepare('INSERT INTO ai_calls(created_at,model,status,cost) VALUES (?,?,?,?)').run(new Date().toISOString(), this.model, 'reserved', maximum).lastInsertRowid;
      })();
      let transient = false;
      try {
        const response = await (this.options.fetcher ?? fetch)('https://api.deepseek.com/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
          body: encoded, signal: AbortSignal.timeout(45000),
        });
        if (!response.ok) {
          transient = [408, 429, 500, 502, 503, 504].includes(response.status);
          throw new AIUnavailable(response.status === 401 ? 'Autenticazione DeepSeek fallita.' : response.status === 402 ? 'Credito DeepSeek esaurito.' : `Provider indisponibile (${response.status}).`);
        }
        const result = await response.json() as any;
        const usage = result.usage;
        if (!Number.isSafeInteger(usage?.prompt_tokens) || !Number.isSafeInteger(usage?.completion_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 0) throw new AIUnavailable('Provider senza contabilizzazione valida.');
        const cost = (usage.prompt_tokens * inputPrice + usage.completion_tokens * outputPrice) / 1e6;
        this.db.prepare('UPDATE ai_calls SET status=?,input_tokens=?,output_tokens=?,cost=? WHERE id=?').run('completed', usage.prompt_tokens, usage.completion_tokens, cost, id);
        const message = result.choices?.[0]?.message;
        if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new AIUnavailable('Risposta provider non valida.');
        return { content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
      } catch (error) {
        this.db.prepare("UPDATE ai_calls SET status='failed' WHERE id=? AND status='reserved'").run(id);
        if (attempt === 0 && (transient || !(error instanceof AIUnavailable))) continue;
        throw error instanceof AIUnavailable ? error : new AIUnavailable('Timeout o connessione DeepSeek non disponibile.');
      }
    }
    throw new AIUnavailable('Provider indisponibile.');
  }
}
