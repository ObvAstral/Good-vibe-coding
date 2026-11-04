# RAG QVAC + DeepSeek — guida di implementazione

## Architettura concordata

QVAC esegue un piccolo modello di embedding locale e gestisce l'indice e il recupero dei documenti. Il backend passa le evidenze recuperate a DeepSeek via API. La generazione non usa il modello linguistico locale dell'esempio CLI. LangChain non è necessario per questo flusso e non va aggiunto come dipendenza iniziale.

```text
Dataset pubblici + eventi Hardhat
  → importazione, calcoli e schede territoriali locali
  → QVAC: embedding, indicizzazione e ricerca
  → backend: evidenze + risultati degli strumenti numerici
  → DeepSeek API
  → chat riservata ai gestori, con fonti e top 3
```

Questa guida prevale sulle precedenti ipotesi di retrieval soltanto testuale o QVAC opzionale. Per dati, geografia e criteri di ranking seguire DATA_PIPELINE.md; per accesso, budget e API seguire AI_E_DATI.md. I pesi e le soglie numeriche del ranking rimangono default proposti, non parametri scientificamente validati.

## Dipendenze e configurazione da realizzare

Nel servizio planner usare l'archivio locale @qvac/sdk 0.23.0 già incluso nel repository e viem per leggere Hardhat. Python prepara i dati normalizzati come descritto nella pipeline; SQLite conserva metadati, aggregati, conversazioni e riferimenti ai documenti, mentre il workspace QVAC conserva l'indice vettoriale.

Il qvac.config.json esistente abilita solo il plugin di completion. Creare una configurazione dedicata del planner con `@qvac/sdk/llamacpp-embedding/plugin` e directory di cache/workspace persistenti. Impostare QVAC_CONFIG_PATH prima dell'import dinamico dell'SDK, risolvendo il percorso rispetto al progetto. Non sostituire l'esempio CLI esistente.

Variabili del futuro `.env.example`, senza valori segreti:

- DEEPSEEK_API_KEY: richiesta per generare risposte, letta soltanto dal backend.
- DEEPSEEK_MODEL: default `deepseek-flash`, da verificare sul provider prima dei test.
- QVAC_CONFIG_PATH: configurazione dedicata del planner.
- QVAC_EMBEDDING_MODEL_PATH: percorso di un GGUF embedding multilingue locale, obbligatorio per l'avvio del RAG.
- HARDHAT_RPC_URL: default `http://127.0.0.1:8545`.
- DEPLOYMENT_MANIFEST_PATH: ABI, indirizzo contratto, chainId e blocco iniziale.
- PLANNER_DB_PATH: default `data/processed/planner.sqlite`.
- RAG_WORKSPACE_PREFIX: default `riciclo-solidale`.
- AI_BUDGET_USD: default proposto `0.60`.

### Modello di embedding: verifica obbligatoria iniziale

Non è ancora stato selezionato e provato un modello embedding sul worker QVAC installato. Scegliere un GGUF multilingue entro il limite di 1B, verificando compatibilità con il plugin embedding e licenza. Il file scelto, versione, fonte, SHA-256, dimensioni dei vettori ed eventuali prefissi query/documento vanno fissati nel manifest di indicizzazione dopo la prova. Non usare automaticamente il modello Llama dell'esempio chat come embedding, né dichiarare validata una compatibilità non provata.

Questa è la prima attività tecnica prima dell'integrazione: import SDK → loadModel embedding → embed su testi italiani → ricerca controllata. La API key DeepSeek non è necessaria per questi controlli. Stesso modello, preprocessing e dimensione vettoriale devono essere usati per documenti e domande. Cambiare modello richiede un nuovo indice.

## Preparazione e aggiornamento della conoscenza

Generare schede sintetiche per quartiere/zona statistica e periodo, separate dalle note metodologiche. Ogni scheda contiene indicatori già calcolati, anno delle fonti, periodo blockchain, unità territoriale, dati mancanti e flag di simulazione. Non incorporare wallet, chiavi o istruzioni operative nei documenti.

La top 3 e i conteggi provengono dalle query sul database completo: i vicini vettoriali non sono la graduatoria delle zone più adatte.

Usare una tabella applicativa di documenti con documentId stabile, versione, testo, fonte, pagina/tavola se applicabile, areaId, anno, periodo, contentHash e ID dei chunk salvati nell'indice. Il record geografico distingue quartiere, zona statistica e circoscrizione.

Preparare chunk per scheda o paragrafo breve, senza spezzare tabelle numeriche e senza unire anni o territori differenti. Il limite effettivo deve rispettare il tokenizer del modello scelto; non troncare silenziosamente. Se una scheda è troppo lunga, dividerla mantenendo in ogni parte il riferimento alla scheda e alle fonti.

Indicizzare con `ragIngest()`, oppure con il flusso esplicito `embed()` → `ragSaveEmbeddings()` quando serve controllare l'associazione tra documenti e ID. Verificare gli schemi della versione installata, non assumere campi metadata non documentati. Registrare gli ID effettivamente restituiti e gestire droppedIndices: un import incompleto non diventa attivo.

Workspace versionati per modello e snapshot dei dati. Costruire una nuova versione, provarla, poi attivarla atomicamente tramite un puntatore nel database. Una ricerca deve usare lo stesso snapshot per documenti e risultati numerici. Riavvio del servizio: riusare il workspace attivo, senza reindicizzare tutto. Modifiche alle transazioni, rollback o nuovi dataset invalidano le schede interessate; per il prototipo ricostruire lo snapshot completo. Conservare l'ultima versione valida se l'aggiornamento fallisce.

Non eseguire ragReindex su un corpus inferiore al minimo richiesto dal backend scelto; il relativo mancato reindex non equivale a perdita dei documenti. Il vector store integrato è documentato come prototipo: è accettato per la demo locale, non come scelta già validata per produzione.

## Risposta a una domanda

1. Verificare sessione, limiti e budget prima di chiamare DeepSeek.
2. Risolvere periodo e territori dal messaggio e dal contesto della conversazione. Chiedere chiarimenti quando il riferimento è ambiguo, senza scegliere una zona arbitraria.
3. Eseguire `ragSearch()` per recuperare evidenze pertinenti, default topK 12. Mappare gli ID ai documenti applicativi, verificando snapshot, anno e territorio. Se i risultati filtrati non bastano, ampliare fino a 40 risultati; non introdurre documenti fuori filtro per riempire il contesto. Inviare al modello al massimo sei chunk entro il budget di contesto.
4. Fornire a DeepSeek gli strumenti numerici descritti in AI_E_DATI.md. Le domande su conteggi richiedono query strutturate; le raccomandazioni richiedono `recommend_locations`, che valuta tutti i candidati e poi recupera le evidenze pertinenti. Registrare input e output degli strumenti per verificare la risposta.
5. Chiamare DeepSeek tramite API dal backend, con domanda, contesto breve, evidenze e riferimenti. QVAC non effettua questa chiamata al posto del backend. Il modello restituisce una risposta con fonti e, se pertinente, raccomandazioni strutturate.
6. Validare candidati e riferimenti. I valori numerici visualizzati nelle schede derivano dagli strumenti; se il modello li altera, rifiutare la relativa risposta strutturata. Una fonte valida non garantisce che la motivazione libera sia corretta: includere test manuali delle spiegazioni.
7. Restituire risposta, fonti, anni, periodo e stato di sincronizzazione. Con dati insufficienti astenersi o restituire meno di tre proposte.

## Errori e ciclo di vita

In caso di modello embedding assente o indice indisponibile: stato RAG non pronto, messaggio esplicito e nessuna risposta generica presentata come fondata sui dataset. Rendere comunque consultabili i risultati numerici disponibili. Con DeepSeek irraggiungibile o credito esaurito: mostrare dati/ranking strutturati e dichiarare indisponibile la spiegazione AI.

Non modificare il modello di embedding a ogni richiesta. Caricarlo all'avvio del servizio, limitare l'indicizzazione concorrente e coordinare gli aggiornamenti con le letture. Alla chiusura scaricare il modello, chiudere il workspace e il client QVAC. Non confondere la persistenza dell'indice con la permanenza del modello in RAM.

## Prove di accettazione

- Ricerca italiana: domande parafrasate su reddito, copertura e utilizzo recuperano schede pertinenti; testare almeno 15 coppie domanda/evidenza attesa.
- Filtri: documenti di anni o quartieri errati non entrano nel contesto; domande senza evidenze non ricevono fatti inventati.
- Aggiornamenti: niente duplicati dopo due importazioni; nuova versione visibile dopo lo switch; vecchia versione conservata se l'import fallisce; riavvio senza perdita dell'indice.
- Compatibilità: modello caricato sul worker, vettori coerenti tra ingest e query, droppedIndices gestiti.
- Separazione: retrieval funzionante senza DeepSeek; test di integrazione API solo con chiave configurata e tetto di spesa, mai richiesta nel repository.
- Domande: conteggi confrontati con SQL; top 3 confrontata con il ranking; quartieri distinti e riferimenti esistenti; provenienza sintetica sempre visibile per Hardhat.

## Riferimenti

- QVAC SDK API: https://docs.qvac.tether.io/sdk/reference/api/
- DeepSeek API: https://api-docs.deepseek.com/
- Schemi effettivi: dichiarazioni `.d.ts` nel pacchetto SDK 0.23.0 incluso nel repository.

Stato: specifica tecnica; configurazione embedding, pipeline e chat devono ancora essere implementate e collaudate.
