# Consegna AI — 4 novembre 2026

## Ripartire da qui

L'utente ha chiesto di salvare e pubblicare il progresso per far continuare i
colleghi. Non considerare il collaudo completo: il conteggio con DeepSeek reale
funziona; la risposta libera sulle raccomandazioni richiede ancora la verifica
finale descritta sotto. Non rigenerare lo storico, già consegnato da un collega.

Leggere anche `planner/GUIDA.md`, `docs/TRANSAZIONI_SIMULATE.md`,
`docs/INTERFACCIA_PLANNER.md` e le specifiche AI. Base integrata dal remoto:
`13588a4` (protocollo 3 e pacchetto history-v1).

## Decisioni dell'utente

- Divisione pubblica: i 23 quartieri, come Crocetta e Pozzo Strada; accetta un
  raccordo geografico approssimato. Le zone statistiche restano evidenze interne.
- Non creare un nuovo storico: usare le 5.000 operazioni in 180 giorni del collega.
- Nel protocollo 3 i punti hanno il quartiere negli eventi. Non inventare
  coordinate e non attribuire le operazioni di quartiere a singole zone statistiche.
- Chiedere chiarimento se emerge una scelta sostanziale discutibile; testare le
  modifiche. La chiave DeepSeek deve rimanere locale e fuori da Git.

## Implementato

- `analytics/`: import demografia 2025, geometrie, raccordi zona/quartiere per
  maggiore superficie, IDISE 2023, record commerciali e contesto descrittivo PDF.
  SQLite WAL, checksum e report. 23 quartieri, 94 zone, 89 IDISE disponibili,
  cinque null; residenza virtuale esclusa dalla geografia. 5.849 record alimentari
  o misti deduplicati, considerati partner potenziali e non affiliazioni attive.
  Dipendenze Python fissate in `analytics/uv.lock`.
- `planner/src/history.ts`: import del pacchetto del collega con verifica di tutti
  i checksum, decodifica delle ricevute, confronto con events.jsonl e riconciliazione
  dei totali. Importa registrazioni e cambi di stato, non solo depositi/acquisti.
  Le 95 schede RAG entrano nel corpus; domande di valutazione e wallet restano fuori.
- Indicizzatore live in sola lettura con viem, soglia latest-2, rilettura di 12
  blocchi, deduplicazione e ricostruzione dopo rollback/reset. Identità include
  chainId, contratto e hash del deployment. Storico e rete live non si mescolano.
- Strumenti: utilizzo, confronti, trend, raccomandazioni e ricerca evidenze.
  Conteggi uint256 con BigInt, distinti ricalcolati dalla finestra e giorni abilitati
  integrati dai cambi di stato. Ranking su tutti i candidati, massimo tre quartieri
  distinti, categorie espansione/pilota separate, pesi documentati.
- Ranking per quartiere: copertura e utilizzo dal quartiere on-chain; evidenza
  sociale dalla sottozona associata con IDISE pubblicato più alto. Non è un indice
  ufficiale dell'intero quartiere e non è una media ponderata per superficie.
- QVAC embedding locale Qwen3 Embedding 0.6B Q8_0, pooling last, 1024 dimensioni;
  versione/licenza/checksum fissati in `planner/embedding-model.json`. Workspace
  versionati, snapshot coerente per query numeriche e documenti, attivazione atomica,
  cache persistente degli embedding e lock delle indicizzazioni concorrenti.
- Backend DeepSeek via fetch, budget persistente iniziale 0,60 USD, prenotazioni
  conservative, limite output, non-thinking, timeout e retry controllati. Nessuna
  funzione di scrittura blockchain disponibile al modello.
- Sessioni HttpOnly/SameSite Strict, utenti scrypt con salt, limitazioni login/chat,
  conversazioni isolate e validazione di strumenti, riferimenti e numeri.
- Pagina React `/gestione/chat`, priorità e date, fonti, schede, stato RAG, fallback
  numerico, layout desktop/mobile. Proxy planner sulla porta 3002, API operative
  conservate sulla 3001. Link all'area gestori dal footer del simulatore.

## Verifiche effettivamente eseguite

- Test operativi dopo il pull: 11 contratto, 15 backend, 4 integrazione, 3 storico;
  tutti passati. I nove test browser del simulatore sono passati.
- Planner: suite TypeScript da 35 test e tre test JS passata prima degli ultimi
  correttivi; successivamente passati test mirati aggiuntivi su date, formattazione,
  priorità, chat e aggiornamenti durante ingest. Rilanciare la suite completa per
  ottenere il conteggio finale. Nove test Python passati.
- Typecheck e build passati. Dopo gli ultimi cambi server sono passati typecheck
  e sei test mirati analytics/validation; non è stata fatta un'altra build completa.
- Browser planner su copia temporanea del DB: login, tre proposte, priorità,
  fallback, logout e mobile senza overflow verificati.
- Compatibilità embedding su fixture sintetiche: 15/15.
- Corpus reale di 974 schede: indice completato, riaperto in un processo nuovo,
  15/15 ricerche passate su popolazione, IDISE, trend e metodologia dello storico.
- DeepSeek reale: una domanda sullo storico completo ha chiamato get_usage e
  risposto correttamente 47.911 bottiglie/47.911 RCS, 2.783 conferimenti e 2.217
  acquisti, con fonti e flag di simulazione. Non è solo un test con provider finto.

## Priorità per chi continua

1. **Ritestare la raccomandazione con DeepSeek reale.** Le prove hanno attivato
   correttamente i tool ma il testo libero è stato rifiutato dal controllo numerico.
   Sono stati corretti arrotondamenti e formattazione italiana, esposti anche i pesi
   in percentuale nel risultato e aggiunto `validationIssues` alla risposta API.
   L'ULTIMA aggiunta dei pesi percentuali non è ancora stata collaudata con una nuova
   chiamata reale. Non assumere che questo caso sia risolto.
2. È stato anche corretto un periodo inventato dal modello (2025 invece di 2026):
   ora il backend determina date e priorità da UI, default e richieste esplicite,
   e aggiorna gli argomenti nella conversazione tool. I test mirati sono passati.
   Controllare i prossimi input in tool_audit e il periodo della risposta.
3. Verificare dalla pagina la domanda: «Dove suggerisci di installare nuovi bidoni,
   e perché? Cita le fonti e distingui potenziamento e progetti pilota.» Nel default
   equilibrato attuale il backend calcola Aurora e Barriera di Milano come espansioni,
   Le Vallette come pilota. Non confrontare direttamente i punteggi delle categorie.
4. Durante questa prova NON eseguire build/compile o modificare file frontend:
   la rigenerazione di shared/src/abi.ts può causare HMR e interrompere il fetch del
   browser. Una prova è scaduta nel browser mentre l'API aveva già elaborato il turno.
5. Eseguire `npm run test:ai`, `npm test`, `npm run build` e, se necessario dopo
   modifiche UI, le due suite browser. Non consumare credito con i test ordinari:
   il provider lì è simulato. Fare poche prove reali mirate, con budget attivo.
6. Rendere eventualmente più leggibile il testo Markdown delle risposte nella UI:
   attualmente è visualizzato come testo React, non come HTML.

## QVAC: problemi trovati e correzioni importanti

- HyperDB deduplica per CONTENUTO, non per ID. Frasi duplicate dei PDF bloccavano
  l'ingest. Le schede ora sono deduplicate, con fonti unite e metadati territoriali
  e anno presenti nei frammenti. Verificato che gli attuali chunk dello storico non
  abbiano collisioni di contenuto tra periodi differenti.
- Il backend HyperDB ha bucket da 50 elementi: salvando una scheda alla volta,
  senza ribilanciare, la ricerca vedeva soltanto le schede recenti. Ora serve
  ragReindex dopo il salvataggio completo (solo con almeno 16 documenti), e la
  ricerca usa n=16 su questo corpus demo. Questo ha portato la verifica reale
  da 3/15 a 15/15. NON rimuovere questa fase perché l'ingest restituisce successo.
- Un workspace chiuso da un processo precedente non viene cancellato dal solo
  close(deleteOnClose): ora closeWorkspace usa anche ragDeleteWorkspace esplicito.
- `indexVersion: full-buckets-v2` entra nell'hash dello snapshot. Se cambia la
  semantica di indicizzazione, cambiare la versione e ricostruire.
- La chiusura prova unloadModel e comunque chiude SDK e cache; durante SIGTERM
  il worker può avere già scaricato il modello. Gestita la chiusura idempotente.

## Avvio e artefatti locali

```sh
npm ci
uv sync --project analytics --locked --python 3.12
npm run analytics:import
npm run analytics:context
npm run planner:history
npm run planner:index
npm run planner:verify-rag
npm run planner:user -- nome.gestore
npm run planner:serve
npm run dev:web
```

Per il modello seguire `planner/README.md`; non è incluso in Git. La prima
indicizzazione su questa CPU è stata lenta; la cache consente di ricostruire le
strutture dell'indice in pochi secondi senza ricalcolare gli embedding.

Nell'ambiente corrente il backend e Vite sono stati lasciati avviati su
127.0.0.1:3002 e 127.0.0.1:5173. Sono processi di sviluppo, non un deploy persistente.
Account locale `gestore` creato; password non inserita nei file del repository.
La configurazione .env contiene la chiave fornita dall'utente: è ignorata da Git,
permessi 600, e il template .env.example mantiene la chiave vuota. Non copiarla
in codice, documentazione, test, screenshot o messaggi ai colleghi.

Artefatti NON pubblicati (ricreabili):

- `data/processed/planner.sqlite` e report di importazione/geografia.
- `.qvac/models/` e `.qvac/planner/embeddings.sqlite`, workspace HyperDB.
- `.data/planner/embedding-probe.json`, `rag-real-verification.json`,
  `deepseek-smoke.json`, `deepseek-recommendation-smoke.json`, screenshot.
  Il report della raccomandazione attualmente registra un tentativo rifiutato:
  non usarlo come prova di generazione riuscita.
- Al momento della consegna: 8 chiamate provider completate, costo applicativo
  stimato complessivo 0,01283 USD, non una lettura del saldo del provider.

Restano inoltre un backup locale pre-pull in `/tmp/riciclo-ai-backup-20261104-141355`
e lo stash «AI planner before colleague package pull». Il lavoro è stato ripristinato
e i conflitti risolti preservando protocollo 3 e comandi dei colleghi.
