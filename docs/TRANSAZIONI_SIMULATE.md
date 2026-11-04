# Storico di transazioni simulate per il RAG

Lo storico è disponibile in [data/simulated/history-v1](../data/simulated/history-v1/README.md). È un dataset di **180 giorni, 5.000 operazioni e 120 wallet cliente fittizi**, dal **5 maggio al 31 ottobre 2026**, in UTC. I conferimenti, i clienti e i comportamenti sono simulati; transazioni, hash, gas, ricevute e log sono prodotti eseguendo il contratto RCS di protocollo `3` su Hardhat locale. Non sono dati di utilizzo reale dei quartieri di Torino.

Il generatore usa i **10 bidoni e i 6 supermercati fissi** del contratto. Non aggiunge punti e non cambia il loro quartiere. I clienti hanno zero ETH; firmano le autorizzazioni agli acquisti, inviati e pagati dagli operatori dei supermercati. Le macchinette pagano il gas dei conferimenti.

Archivio completo da condividere: [riciclo-solidale-history-v1.zip](../data/simulated/riciclo-solidale-history-v1.zip), circa 2,7 MB; include anche manifest e checksum.

## Cosa passare al RAG

Usare [rag-documents.jsonl](../data/simulated/history-v1/rag-documents.jsonl): ogni riga è una scheda autonoma con `documentId`, `version`, `title`, `text`, `contentHash` e `metadata`. Il campo `text` è il contenuto da incorporare con il modello embedding. I metadati conservano provenienza simulata, unità territoriale, ID del quartiere, estremi inclusi del periodo UTC e file di evidenza. Conservare nel database l'associazione tra documento e ID effettivo restituito dall'indice QVAC.

In alternativa [rag-corpus.md](../data/simulated/history-v1/rag-corpus.md) contiene lo stesso corpus leggibile: ogni sezione di livello 2 è una scheda. Scegliere uno dei due formati per evitare duplicati. Le schede comprendono il riepilogo della rete, tutti i 23 quartieri del catalogo, i mesi dei quartieri con punti installati, confronti tra gli ultimi 30 giorni e i 30 precedenti, metodologia e limiti. Gli indirizzi dei wallet non compaiono nel corpus.

L'export prepara i documenti, ma non crea embedding o un indice QVAC attivo. Per quella parte seguire [RAG_QVAC_DEEPSEEK.md](RAG_QVAC_DEEPSEEK.md). Non importare nell'indice le domande di valutazione, le chiavi demo, i wallet o l'intero insieme di ricevute.

## Dati per conteggi e analisi

| File | Contenuto |
| --- | --- |
| [events.jsonl](../data/simulated/history-v1/events.jsonl) | Un evento `BottlesDeposited` o `PurchaseCompleted` per riga: formato `PlannerEvent`, più `source`, `simulated` e `protocolVersion`. Comprende hash/blocco/logIndex, timestamp, quartiere, circoscrizione e argomenti decodificati. |
| [events.csv](../data/simulated/history-v1/events.csv) | Gli stessi eventi in forma tabellare, con campi distinti per bottiglie, RCS emessi/bruciati, cliente, punto e carrello. |
| [transactions.jsonl](../data/simulated/history-v1/transactions.jsonl) | Ricevute Hardhat complete dei log EVM, mittente e gas misurato. Comprende anche 5 transazioni di deploy/catalogo e 2 cambi di stato, oltre alle 5.000 operazioni. |
| [aggregates.json](../data/simulated/history-v1/aggregates.json) | Totali dell'intero periodo, per quartiere/punto/giorno/mese, copertura e confronto tra periodi. |
| [daily-neighborhoods.csv](../data/simulated/history-v1/daily-neighborhoods.csv) | Aggregati giornalieri dei quartieri con eventi osservati. |
| [points.json](../data/simulated/history-v1/points.json) | Catalogo dei punti, prezzi dei prodotti e disattivazione/riattivazione con hash della transazione. |
| [wallets.json](../data/simulated/history-v1/wallets.json) | Saldi finali RCS/ETH dei clienti fittizi, per riconciliazione locale; fuori dal corpus RAG. |
| [deployment.json](../data/simulated/history-v1/deployment.json) | ABI e identità della rete temporanea esportata; non sostituisce `deployments/local.json`. |
| [manifest.json](../data/simulated/history-v1/manifest.json) | Parametri, seed, intervallo, snapshot, hash semantico, verifiche e checksum SHA-256 dei file. |
| [evaluation-questions.json](../data/simulated/history-v1/evaluation-questions.json) | 20 domande con risposte attese dai dati e documenti da citare. |

I `uint256` sono stringhe decimali: in TypeScript convertirli in `BigInt` per le somme. Le date sono UTC. Per deduplicare un log usare `(chainId, contractAddress, transactionHash, logIndex)`; per distinguere i deployment includere anche `deploymentBlockHash`/identità dello snapshot come descritto nell'[interfaccia planner](INTERFACCIA_PLANNER.md).

Conteggi e classifiche vanno calcolati sullo storico completo o sugli aggregati che corrispondono esattamente al periodo richiesto. Non contare i soli documenti restituiti dalla ricerca vettoriale. Non sommare i wallet distinti di più giorni, mesi o quartieri: la stessa identità può comparire in più gruppi. Il cliente dell'acquisto è `PurchaseCompleted.buyer`, mentre il mittente della transazione è l'operatore del supermercato.

## Scenari e interpretazione

Il seed fisso produce pesi di utilizzo crescenti ad Aurora, decrescenti a Santa Rita e in crescita nella seconda metà del periodo a San Salvario. Sono ipotesi fittizie per collaudare confronti: i valori osservati e le percentuali effettive sono in `aggregates.json`, non vanno dedotti dai nomi degli scenari.

Il bidone `10`, a Madonna di Campagna, è disattivato dal **25 luglio 2026 alle 00:00 UTC** al **21 agosto 2026 alle 00:00 UTC**, con estremi iniziale incluso e finale escluso: 27 giorni. Il negozio dello stesso quartiere resta attivo. Il campo `activeMachineDays` misura i giorni-bidone di esposizione e permette di distinguere un fermo dall'utilizzo di un punto disponibile. Non attribuire ai residenti cause sociali o comportamenti non misurati.

I 13 quartieri senza installazioni non hanno osservazioni di utilizzo. L'assenza di eventi non misura la domanda. Il quartiere dell'evento identifica il punto utilizzato, non la residenza del cliente. Poiché un wallet può conferire e spendere in quartieri diversi, emissioni meno burn per quartiere non sono il saldo dei residenti. Mancano coordinate dei punti, zone statistiche, bisogno sociale e costi per formulare raccomandazioni complete: occorre integrare e validare le fonti pubbliche della [pipeline dati](DATA_PIPELINE.md).

## Generazione e verifica

Dalla radice del progetto:

```sh
npm run simulate:history
```

Il comando compila il contratto, avvia una propria rete su `127.0.0.1:18550`, esegue le operazioni, riconcilia i risultati ed esporta in `data/simulated/history-v1`. Arresta la propria rete al termine. Non modifica il manifest, il database o il nodo della demo interattiva. Rifiuta la porta `8545`, una porta già in uso e cartelle di output esistenti. L'export viene pubblicato soltanto dopo la riconciliazione completa.

Per un nuovo export con parametri diversi:

```sh
npm run simulate:history -- --seed 42 --start 2026-05-05 --days 180 --operations 5000 --customers 120 --port 18550 --output data/simulated/history-seed42
```

Stessi parametri riproducono il piano delle operazioni, le date, gli importi e i saldi finali. Gli hash blockchain e la data di export possono variare tra reti temporanee. `semanticPlanSha256` identifica il piano, mentre gli SHA-256 nel manifest verificano l'integrità dello specifico export. I parametri non dipendono dal file `.env` della demo.

Il generatore controlla tutte le ricevute, l'identità dei mittenti, la corrispondenza degli eventi con il piano, saldo di ogni cliente e offerta totale. Confronta inoltre la diminuzione di ETH di ciascun operatore con la somma di `gasUsed × effectiveGasPrice` delle sue operazioni. Tutti i clienti devono terminare con zero ETH.

```sh
npm run test:history
npm run typecheck
```

I test controllano determinismo, vincoli del piano, riconciliazione dai log EVM, cambi di stato, aggregati, checksum, riferimenti delle domande e assenza di wallet nel corpus. `npm test` include anche questi controlli. La generazione dello storico non sostituisce l'indicizzatore persistente del planner, né ne implementa rollback, sincronizzazione continua o ranking.
