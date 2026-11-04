# Planner locale: dati, ricerca e chat

Il planner legge le transazioni del collega. **Non contiene un generatore dello
storico** e non modifica il contratto operativo. Le piccole transazioni presenti
nei test vengono eseguite soltanto su una rete temporanea isolata.

## Preparazione

Prerequisiti: Node >=22.17, Python 3.12–3.14, uv e Poppler (`pdftotext`).
Dalla radice, dopo `npm ci`:

```sh
uv sync --project analytics --locked --python 3.12
npm run analytics:import
npm run analytics:context
```

Copiare `.env.example` in `.env` e configurare i percorsi. Scaricare e verificare
il modello come descritto in `planner/README.md`. SQLite usa WAL; dati elaborati,
modello, workspace e credenziali rimangono fuori da Git.

## Pacchetto del collega e protocollo 3

Il pacchetto già consegnato è `data/simulated/history-v1`: 5.000 operazioni in
180 giorni, ricevute e 95 schede RAG. Il planner lo usa per default con
`PLANNER_SOURCE=history`; non avvia una rete e non rigenera transazioni.

```sh
npm run planner:history
```

L'import verifica tutti i checksum, decodifica i log delle ricevute con l'ABI del
pacchetto e confronta i 5.000 eventi normalizzati. Ricostruisce anche registrazione
e cambi di stato dei punti, riconcilia i totali e aggiorna il database in una
transazione. Ripetere l'import dello stesso pacchetto non duplica dati.
`rag-documents.jsonl` è l'unico corpus importato dallo storico: domande di valutazione,
wallet e ricevute non entrano nell'indice. Queste ultime restano nel livello locale
di calcolo dei distinti. Le 20 domande del collega servono alla verifica.

I quartieri dei 16 punti fissi provengono da `neighborhoodId` degli eventi del
protocollo 3. Non servono coordinate. Il cliente dell'acquisto è `buyer`, mentre
il mittente della transazione è l'operatore del negozio. Quartiere del punto e
residenza del cliente sono concetti distinti. Le zone statistiche dei punti sono
sconosciute: non vengono inventate per completare l'analisi.

Per leggere invece la demo interattiva, impostare `PLANNER_SOURCE=live`, usare
il manifest di protocollo 3 prodotto dal collega in `deployments/local.json` e:

```sh
npm run planner:sync
```

La modalità live legge fino a due blocchi prima della testa, rilegge almeno 12
blocchi e ricostruisce dal deployment quando cambia l'hash del cursore. Il server
sincronizza ogni 30 secondi solo in modalità live. Non resettare la rete del collega.
Lo storico esportato e la rete interattiva non vengono mescolati, anche quando
chainId e indirizzo sono uguali: conta anche l'hash del blocco di deployment.
Un cambio di sorgente richiede un nuovo `planner:index`; fino ad allora lo snapshot
precedente resta esplicitamente marcato come non aggiornato.

Un eventuale registro di coordinate WGS84 verificate è aggiuntivo, non richiesto
per la demo. `planner:points` accetta un JSON con chainId, contractAddress,
deploymentBlockHash e points: [{pointId, latitude, longitude}]. Non inventare
coordinate dai nomi. Il quartiere on-chain rimane autorevole; per un punto spostato
occorre un nuovo ID. Il contratto attuale non consente di aggiungere punti.

## Indicizzazione e avvio

```sh
npm run planner:index
npm run planner:user -- nome.gestore
```

Il secondo comando legge la password da stdin (almeno 12 caratteri), fino a EOF
(Ctrl+D). Per non mostrarla nel terminale, usare un password manager che scriva
su stdin; non inserirla negli argomenti del comando. Non esistono credenziali
predefinite. La password è conservata come hash scrypt con salt. Una sua modifica
revoca le sessioni del gestore.

Avviare il planner e, in un altro terminale, il frontend:

```sh
npm run planner:serve
npm run dev:web
```

Aprire **http://127.0.0.1:5173/gestione/chat**. Il backend del planner ascolta solo
su 127.0.0.1:3002; il proxy Vite lascia le API del simulatore sulla porta 3001.
Con una porta diversa impostare anche PLANNER_PROXY_TARGET per Vite.

L'indice QVAC è persistente e usa lo stesso snapshot dei risultati numerici. La
costruzione attiva il nuovo snapshot solo dopo il salvataggio completo e una
ricerca di controllo. Un import fallito conserva l'indice precedente. Il server
riusa l'indice attivo; non ricostruisce il corpus a ogni domanda. Dopo nuovi dati,
posizioni o sincronizzazioni, eseguire `planner:index`; fino ad allora la pagina
segnala che usa l'ultima versione indicizzata. Eseguire una sola indicizzazione
alla volta. La prima elaborazione dell'intero corpus può richiedere diversi minuti
su CPU. Non serve DeepSeek per costruirla.

## Risposte, dati mancanti e costi

Impostare DEEPSEEK_API_KEY **solo nel file .env del server** per abilitare la
generazione. Il modello predefinito è deepseek-flash, in modalità non-thinking.
Senza chiave la pagina mostra comunque proposte e fonti locali. Anche con chiave,
un RAG assente o una spiegazione non valida impediscono di presentare una risposta
AI come fondata sui dati. I test ordinari del provider usano risposte simulate. Dopo configurazione della
chiave sono state eseguite poche prove reali mirate; stato e problemi ancora aperti
in `docs/HANDOFF_AI.md`.

Budget applicativo iniziale: 0,60 USD, persistito in ai_calls. Ogni chiamata riserva
il costo massimo usando un limite conservativo dei token e i prezzi di picco;
la risposta contabilizza poi i token effettivi, senza sconto cache. Le chiamate
fallite senza dati di consumo mantengono la prenotazione prudenziale. Questo è un
limite applicativo, non una lettura del saldo DeepSeek. Prezzi verificati il
4 novembre 2026: Flash input 0,30/output 1,20 USD per milione; Pro 1,32/3,96.
Per altri modelli servono override espliciti dei prezzi. Riferimenti ufficiali:
[prezzi](https://api-docs.deepseek.com/quick_start/pricing/),
[tool calling](https://api-docs.deepseek.com/guides/tool_calls/).

Limiti: 1 chat contemporanea, 10 richieste/minuto per gestore, 2.000 caratteri per
messaggio, ultimi 4 turni, massimo 3 cicli di strumenti e 5 strumenti per ciclo;
timeout locale 8 secondi, provider 45 secondi, un solo retry transitorio soggetto
al budget, nessun retry su autenticazione o credito. Login: 5 tentativi/minuto/IP.
Sessioni opache di 8 ore, cookie HttpOnly e SameSite=Strict. Il servizio è una demo
locale; HTTPS e cookie Secure restano necessari per un eventuale rilascio remoto.

Il ranking segue i pesi della specifica, con fino a due espansioni e un pilota,
completando con l'altro gruppo se necessario. Le proposte hanno quartieri distinti.
Senza storico si mostra soltanto una priorità sociale preliminare: copertura e
utilizzo sono indisponibili. Copertura e utilizzo si calcolano per quartiere; il
segnale sociale preliminare usa la sottozona associata con IDISE pubblicato più
alto, sempre etichettata come tale. IDISE non viene mediato per superficie. I dati delle operazioni locali restano marcati come
simulati. Record alimentari/misti sono partner potenziali, non affiliazioni attive.
Le tabelle numeriche PDF non sono importate automaticamente: le estrazioni
descrittive conservano pagina/anno e non alimentano punteggi di quartiere.

API protette: POST /api/chat, GET /api/recommendations, GET /api/planner/status,
DELETE /api/session. Solo POST /api/session è pubblico. `recommendations` accetta
preference=balanced|social|usage e opzionalmente from/to (date YYYY-MM-DD incluse).
Il periodo predefinito usa gli ultimi 30 giorni UTC conclusi rispetto al blocco
indicizzato. Chat accetta message, conversationId opzionale e selezioni preference/period opzionali; restituisce testo,
fonti, periodo, blocco, flag di simulazione, risultati degli strumenti e proposte.

## Verifiche

Per lo stato effettivo della consegna e i casi ancora da collaudare leggere
`docs/HANDOFF_AI.md`. La verifica reale del RAG è `npm run planner:verify-rag`.

```sh
npm run test:ai
npm test
npm run build
npx playwright install chromium
npm run test:planner:ui
```

I test browser usano una copia temporanea del database importato e credenziali
dimostrative usa e getta. Non cambiano i gestori del database effettivo. Le prove
di generazione reale richiedono la chiave e vanno eseguite separatamente con il
budget configurato; i test automatici ordinari non consumano credito.
