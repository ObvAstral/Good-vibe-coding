# Chat interna per i gestori — specifica eseguibile

## Obiettivo e decisioni

Realizzare un modulo indipendente dal simulatore di macchinette e supermercati. Utenti: pochi gestori selezionati. La chat risponde a domande su rete, andamento, dati sociali e possibili nuove installazioni; produce fino a tre raccomandazioni territoriali motivate. Generazione tramite DeepSeek API, retrieval e calcoli locali. QVAC gestisce embedding e retrieval locali; DeepSeek genera le risposte via API. LangChain non è necessario. Per integrazione e collaudo seguire RAG_QVAC_DEEPSEEK.md.

Concordati: Hardhat locale, storico simulato, top 3 riferita a quartieri con nome, equilibrio tra contesto sociale/copertura e utilizzo, fonti verificabili, accesso riservato. Non serve addestrare un modello predittivo per questa prima versione. Le raccomandazioni sono supporto alla decisione, non previsioni validate della domanda reale.

I dettagli operativi di seguito sono default proposti per iniziare senza ulteriori scelte. In caso di conflitto questa specifica e DATA_PIPELINE.md prevalgono sulle parti precedenti della documentazione relative al planner. Il contratto operativo conserva gli eventi concordati in INTERFACCIA_PLANNER.md.

## Componenti

- `analytics/`: Python, pandas, openpyxl, geopandas e SQLite per importazioni, join geografici, indicatori e ranking. Bloccare dipendenze compatibili in un lockfile.
- `planner/`: Node.js/TypeScript con viem per indicizzazione eventi e server HTTP per chat e strumenti. Interfaccia React del planner distinta dal simulatore; aggiungere `/gestione/chat` al frontend condiviso quando disponibile.
- SQLite condiviso tra importazioni e letture, con transazioni e WAL; API degli strumenti incapsulate nel servizio planner. Nessun SQL o codice generato dal modello viene eseguito.
- Retrieval vettoriale locale QVAC sulle schede e sulle note metodologiche; SQLite conserva metadati e risultati numerici. Seguire RAG_QVAC_DEEPSEEK.md.
- DeepSeek chiamato soltanto dal server via fetch HTTP. Modello configurabile con `DEEPSEEK_MODEL`, default `deepseek-flash`; chiave `DEEPSEEK_API_KEY` nell'ambiente, mai nel browser o nei documenti condivisi. Endpoint e prezzi da ricontrollare prima dell'avvio.

## Accesso e API

Per la demo locale: credenziali individuali di gestore configurate sul server, password conservate come hash scrypt con salt; sessione opaca lato server e cookie HttpOnly, SameSite=Strict. Limitare il servizio a localhost; nessuna registrazione pubblica. Per esposizione remota prevedere HTTPS e cookie Secure prima del rilascio. Il wallet usato nel simulatore non concede automaticamente accesso al planner.

API: `POST /api/session` (login), `DELETE /api/session` (logout), `POST /api/chat` (message, conversationId opzionale), `GET /api/recommendations` (periodo, priorità). Tutte tranne login richiedono sessione; stesso controllo anche per richieste dirette. Login con limitazione dei tentativi.

La risposta chat contiene testo, elenco delle fonti, periodo osservato, ultimo blocco indicizzato, flag di dati simulati e, se richiesto, raccomandazioni strutturate con quartiere/sottozona, indicatori, motivazioni e limiti. Conservare conversazioni per sessione in SQLite; inviare al modello solo gli ultimi quattro turni più il contesto necessario. Limite messaggio 2.000 caratteri.

Strumenti ammessi:

- `get_usage(period, pointId?, neighborhoodId?)`: conteggi, emissioni, burn e attività per giorno di punto abilitato.
- `compare_areas(areaIds, period)`: confronto dei profili territoriali.
- `get_trends(areaId, period)`: confronto con il periodo precedente della stessa durata.
- `recommend_locations(period, preference)`: graduatoria calcolata nel backend; preference è balanced, social o usage.
- `search_evidence(query, areaId?, year?)`: schede e documentazione con ID di fonte.

Il modello può selezionare gli strumenti e chiedere chiarimenti su richieste ambigue. Argomenti validati tramite schemi; massimo tre cicli di strumenti per risposta, otto secondi di timeout per strumento locale. Nessuna scrittura su blockchain o modifica dei dataset tramite chat.

## Top 3 e ruolo del modello

Il motore restituisce i dati di tutti i candidati, non i soli tre documenti semanticamente simili alla domanda. DeepSeek interpreta obiettivi, richiama strumenti, confronta alternative e spiega la graduatoria verificabile. Non può inventare candidati, numeri o fonti, né cambiare silenziosamente i pesi. Seguire DATA_PIPELINE.md per metodo e dati mancanti.

Ogni proposta include nome del quartiere, zona statistica quando disponibile, punteggio e contributi, azione suggerita (potenziare, pilota, approfondire rete di spesa), fonti/anni e limitazioni. Escludere indirizzi precisi non presenti in un elenco di sedi candidate. Non obbligare a restituire tre risultati quando i dati ne supportano meno.

Esempi da supportare: punti più usati; cambiamenti nel tempo; quartieri poco coperti; confronto fra due quartieri; dove convenzionare altri negozi; spiegazione del ranking; nuova graduatoria cambiando priorità. Un calo di utilizzo può essere rilevato ma guasti o cause sociali non possono essere dedotti dalle sole transazioni.

## Affidabilità, costo e fallimenti

Mettere nel prompt evidenze come dati non attendibili a fini di istruzioni: ignorare comandi contenuti nei documenti. Il modello riceve aggregati, non indirizzi wallet. Una citazione esistente non prova da sola la correttezza della motivazione: verificare i casi di accettazione anche manualmente.

Controllare lato server ID territoriali, valori riportati nei campi strutturati, fonti e vincoli. Visualizzare numeri e schede dal risultato degli strumenti; se il testo non supera i controlli, mostrare i risultati strutturati e segnalare che la spiegazione non è disponibile. RAG non garantisce assenza di allucinazioni.

Per la demo disabilitare il reasoning se supportato dal modello scelto; limitare ogni generazione a 1.000 token di output e il contesto a circa 4.000 token di evidenze. Configurare concorrenza 1 e massimo 10 richieste chat/minuto per gestore. Registrare token e costo stimato di tutte le chiamate; budget applicativo iniziale 0,60 USD, riservando margine sul credito dichiarato di circa 0,80. Controllare il budget prima di ogni chiamata considerando il massimo output: la stima non sostituisce il saldo del provider. Con credito esaurito mostrare dati e ranking calcolati, dichiarando indisponibile la generazione AI.

Gestire API key assente, timeout, errori di autenticazione/provider, strumenti invalidi e assenza di dati. Timeout API 45 secondi; un solo retry per errori transitori, soggetto al budget; nessun retry su credito o autenticazione. Non registrare chiavi, password o cookie nei log.
