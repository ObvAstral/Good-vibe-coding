import React, { useEffect, useState } from 'react';
import './planner.css';
type Recommendation = { neighborhoodId: string; neighborhood: string; category: string; score: number; zone: string; idise: number; idiseYear: number; population: number; populationYear: number; limitations: string[]; sources: string[]; usage: { depositCount: number; activeStores: number | null } };
type Ranking = { top: Recommendation[]; sources: { id: string; url: string; file: string }[]; simulated: boolean; stale: boolean; period: { from: number; to: number } | null; indexedBlock: number | null };
type Answer = { text: string; aiAvailable: boolean; reason: string | null; conversationId: string; evidence: { id: string; content: string; year: number | null }[]; toolResults: { tool: string; result: any }[]; recommendations: Ranking & {preference: string}; sources: Ranking['sources'] };
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Servizio non disponibile.'), { status: response.status });
  return data;
}
const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString('it-IT', { timeZone: 'UTC' });
export default function Planner() {
  const [authenticated, setAuthenticated] = useState(false), [loading, setLoading] = useState(true);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [status, setStatus] = useState<any>(null), [ranking, setRanking] = useState<Ranking | null>(null);
  const [preference, setPreference] = useState('balanced'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [message, setMessage] = useState(''), [conversation, setConversation] = useState<string>();
  const [turns, setTurns] = useState<{ question: string; answer: Answer }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = async () => {
    setError('');
    try { const data = await request('/api/planner/status'); setStatus(data); setAuthenticated(true); }
    catch (e: any) { if (e.status === 401) setAuthenticated(false); else setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!authenticated) return;
    const params = new URLSearchParams({ preference, ...(from && to ? { from, to } : {}) });
    let alive = true;
    request(`/api/recommendations?${params}`).then(data => { if (alive) setRanking(data); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [authenticated, preference, from, to]);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request('/api/session', 'POST', { username, password }); setPassword(''); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim()) return;
    const question = message; setBusy(true); setError('');
    try {
      const answer: Answer = await request('/api/chat', 'POST', { message: question, preference, ...(from && to ? {period:{from,to}} : {}), ...(conversation ? { conversationId: conversation } : {}) });
      if (answer.toolResults.some(r => r.tool === 'recommend_locations')) {
        setRanking({...answer.recommendations,sources:answer.sources});
        setPreference(answer.recommendations.preference);
      }
      setTurns(t => [...t, { question, answer }]); setConversation(answer.conversationId); setMessage('');
    } catch (e: any) { setError(e.message); if (e.status === 401) setAuthenticated(false); }
    finally { setBusy(false); }
  }
  return <main className="planner">
    <header className="planner-head"><div><span className="planner-eyebrow">RICICLO SOLIDALE · AREA GESTORI</span><h1>Decisioni per il territorio</h1><p>Dati, fonti e proposte per i quartieri di Torino.</p></div>
      {authenticated && <button className="planner-secondary" onClick={async () => { await request('/api/session', 'DELETE'); setAuthenticated(false); setTurns([]); setConversation(undefined); setRanking(null); }}>Esci</button>}</header>
    {error && <p className="planner-error" role="alert">{error}</p>}
    {loading ? <p role="status">Caricamento…</p> : !authenticated ? <form className="planner-login" onSubmit={login}>
      <h2>Accesso riservato</h2><p>Usa le credenziali personali del gestore.</p>
      <label>Nome utente<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button disabled={busy}>Accedi</button></form> : <>
      <div className="planner-status"><span className="planner-badge">23 quartieri</span>
        <span>{ranking?.period ? `${date(ranking.period.from)} – ${date(ranking.period.to - 1)}` : 'Storico transazioni non disponibile'}</span>
        {ranking?.simulated && <strong>Transazioni dimostrative</strong>}
        {ranking?.indexedBlock != null && <span>Blocco osservato {ranking.indexedBlock}</span>}
      </div>
      {(ranking?.stale || status?.stale) && <p className="planner-warning">Sono disponibili nuovi dati. Le risposte usano ancora l’ultima versione indicizzata.</p>}
      {!status?.aiConfigured && <p className="planner-warning">Generazione AI non configurata. Puoi già consultare le proposte calcolate e le fonti.</p>}
      {!status?.ragReady && <p className="planner-warning">Ricerca delle evidenze in preparazione. Le proposte numeriche restano consultabili.</p>}
      <section className="planner-section"><div className="planner-section-head"><div><h2>Quartieri da valutare</h2><p>Proposte preliminari a supporto del gestore.</p></div>
        <label>Priorità<select value={preference} onChange={e => setPreference(e.target.value)}><option value="balanced">Equilibrata</option><option value="social">Bisogno sociale</option><option value="usage">Utilizzo osservato</option></select></label></div>
        <div className="planner-dates"><label>Dal<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Al<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><button className="planner-secondary" onClick={() => { setFrom(''); setTo(''); }}>Ultimi 30 giorni disponibili</button></div>
        <div className="planner-grid">{ranking?.top.map(r => <article className="planner-card" key={r.neighborhoodId}>
          <span className="planner-badge">{r.category === 'pilot' ? 'Pilota / dati limitati' : 'Espansione'}</span><h3>{r.neighborhood}</h3>
          <p className="planner-score">{r.score.toFixed(1)}<small> / 100 · {r.category === 'pilot' ? 'priorità preliminare' : 'punteggio'}</small></p>
          <dl><div><dt>Residenti del quartiere · {r.populationYear}</dt><dd>{r.population.toLocaleString('it-IT')}</dd></div><div><dt>IDISE sottozona · {r.idiseYear}</dt><dd>{r.idise.toFixed(2)}</dd></div></dl>
          <details><summary>Evidenze e limiti</summary><p>Sottozona di riferimento: {r.zone}.</p><ul>{r.limitations.map(l => <li key={l}>{l}</li>)}</ul>
            {r.sources.map(id => { const s = ranking.sources.find(s => s.id === id); return s && <p key={id}><a href={s.url} target="_blank" rel="noreferrer">{s.file}</a></p>; })}</details>
        </article>)}</div>
        {ranking && !ranking.top.length && <p>I dati non supportano ancora una proposta territoriale.</p>}
        <p className="planner-note">Punteggi di progetto, non previsioni validate. Espansione e pilota usano criteri diversi: i loro punteggi non sono direttamente confrontabili.</p>
      </section>
      <section className="planner-section"><h2>Chiedi ai dati</h2><p>Confronta quartieri, esplora l’andamento e chiedi il perché delle proposte.</p>
        <div className="planner-chat" aria-live="polite">{!turns.length && <p className="planner-note">Esempio: “Confronta Crocetta e Pozzo Strada” oppure “Dove consigli un nuovo punto?”</p>}
          {turns.map((turn, i) => <article className="planner-turn" key={i}><p className="planner-question">{turn.question}</p><p>{turn.answer.text}</p>
            {!turn.answer.aiAvailable && <p className="planner-warning">{turn.answer.reason}</p>}
            {turn.answer.toolResults.filter(r => ['compare_areas', 'get_usage', 'get_trends'].includes(r.tool)).map((r, j) => <div key={j}>
              {r.tool === 'compare_areas' ? r.result.areas.map((a: any) => <p key={a.id}><strong>{a.name}</strong>: {a.population.toLocaleString('it-IT')} residenti (2025); {a.usage.available ? `${a.usage.depositCount} conferimenti osservati` : 'storico non disponibile'}.</p>) : r.tool === 'get_usage' ? <p>Conferimenti: {r.result.available ? r.result.depositCount : 'non disponibili'} · Acquisti: {r.result.available ? r.result.purchaseCount : 'non disponibili'}</p> : r.result.available && <p>{r.result.area.name}: {r.result.current.depositCount} conferimenti nel periodo; {r.result.previous.depositCount} nel precedente.</p>}
            </div>)}
            {!!turn.answer.evidence.length && <details><summary>Fonti recuperate</summary>{turn.answer.evidence.map(e => <p key={e.id}>{e.content}</p>)}</details>}
          </article>)}
        </div>
        <form className="planner-compose" onSubmit={send}><label htmlFor="planner-message">La tua domanda</label><textarea id="planner-message" maxLength={2000} required value={message} onChange={e => setMessage(e.target.value)} placeholder="Scrivi una domanda sui quartieri…" /><div><small>{message.length}/2000</small><button disabled={busy || !message.trim()}>{busy ? 'Elaborazione…' : 'Invia domanda'}</button></div></form>
      </section>
    </>}
  </main>;
}
