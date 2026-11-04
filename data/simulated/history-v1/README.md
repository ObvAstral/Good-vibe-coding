# Storico simulato Riciclo Solidale

Dati SIMULATI: operazioni eseguite su un contratto reale in Hardhat locale, senza attività reale di cittadini o punti fisici.

- Periodo UTC: 2026-05-05 – 2026-10-31, 180 giorni.
- Operazioni: 5000 (2783 conferimenti, 2217 acquisti).
- Bottiglie / RCS emessi: 47911; RCS bruciati: 25152; offerta finale: 22759.
- 120 wallet cliente fittizi, tutti a zero ETH. Gas pagato da macchinette e supermercati.
- 10 bidoni e 6 negozi fissi in 10 quartieri; altri 13 quartieri senza installazioni.
- Seed: 314159; hash semantico del piano: f73b8770af9a08793c5473437c96391248794b30ce9daf38c0d2c91dc271f3e9.

## File da usare

| File | Uso |
| --- | --- |
| rag-documents.jsonl | Una scheda per riga: usare text per embedding, documentId/version/contentHash e metadata per provenienza e filtri. Nessun wallet nelle schede. |
| rag-corpus.md | Lo stesso contenuto in Markdown, per lettura o import testuale. Ogni sezione è una scheda distinta. |
| aggregates.json | Totali esatti, per giorno/quartiere/punto/mese, esposizione e confronti tra periodi. |
| events.jsonl | Eventi operativi normalizzati di protocollo 3; ogni riga è un PlannerEvent. |
| events.csv | Stessi eventi in forma tabellare; quantità uint256 come stringhe. |
| daily-neighborhoods.csv | Aggregati giornalieri per quartiere, solo gruppi osservati. |
| transactions.jsonl | Ricevute reali Hardhat, log EVM originali, gas e mittente; include anche deploy, catalogo e cambi di stato. |
| deployment.json | ABI e identità del deployment temporaneo, separato dalla demo interattiva. |
| points.json | Catalogo fisso, prezzi e cambi di stato verificabili dalle ricevute. |
| wallets.json | Saldi finali dei wallet fittizi; solo per analisi strutturata, fuori dal RAG. |
| evaluation-questions.json | 20 domande con valori attesi e documenti di riferimento; fuori dall'indice RAG. |
| manifest.json | Parametri, snapshot, controlli e SHA-256 di tutti gli altri file. |

Non caricare tutto indiscriminatamente nell'indice vettoriale. Usare rag-documents.jsonl oppure rag-corpus.md, evitando duplicati. Conteggi e classifiche richiedono query sull'intero events.jsonl o aggregati coerenti col periodo. Non sommare wallet distinti tra gruppi. Il quartiere è quello del punto, non la residenza del cliente. Un quartiere senza punti ha utilizzo non osservabile, non domanda nulla. Non sono inclusi embedding o un indice QVAC già attivo.

## Scenari fittizi

- Aurora: peso di utilizzo crescente nel periodo simulato.
- Santa Rita: peso di utilizzo decrescente nel periodo simulato.
- San Salvario: aumento nella seconda metà del periodo simulato.
- Madonna di Campagna: bidone 10 temporaneamente disattivato; negozio 15 sempre attivo.
- I 13 quartieri senza installazioni non hanno osservazioni di utilizzo.

Bidone 10 disattivato da 2026-07-25T00:00:00.000Z a 2026-08-21T00:00:00.000Z (inizio incluso, fine esclusa); il negozio resta attivo. I pesi degli scenari sono ipotesi del generatore: i confronti effettivi sono in aggregates.json. Mancano dati sociali, coordinate dei punti e costi per formulare raccomandazioni territoriali complete.

## Riproduzione

Dalla radice: npm run simulate:history -- --seed 314159 --start 2026-05-05 --days 180 --operations 5000 --customers 120 --output data/simulated/nuovo-export

Il comando compila, avvia e arresta una rete propria sulla porta 18550 (modificabile con --port). Rifiuta cartelle esistenti e la porta 8545; non modifica deployments/local.json o il database della demo. Stessi parametri riproducono piano, date, quantità e saldi; hash dei blocchi/receipt e data di export possono cambiare tra esecuzioni.
