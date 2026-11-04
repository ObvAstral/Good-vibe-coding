# Ordine di lavoro e accettazione

Leggere prima [RAG_QVAC_DEEPSEEK.md](RAG_QVAC_DEEPSEEK.md), poi [AI_E_DATI.md](AI_E_DATI.md) e [DATA_PIPELINE.md](DATA_PIPELINE.md). Il modulo operativo è già implementato: leggere anche [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md#aggiornamento-per-i-colleghi--protocollo-3) per il protocollo `3`. Implementare il planner senza modificare emissione e burn del simulatore.

## Sequenza

1. Verificare prima il modello embedding multilingue sul worker QVAC e la ricerca locale come descritto nella guida RAG. Importare e validare dataset e geometrie; produrre SQLite, report dei raccordi e schede con fonti. Non aspettare il contratto per questa attività.
2. Usare i quartieri già presenti negli eventi e i 16 punti fissi. Le coordinate non sono richieste dalla demo attuale; un eventuale raccordo a zone statistiche più fini rimane un’attività aggiuntiva. Il contratto è disponibile: compilare con `npm run compile` e usare `deployments/local.json` prodotto dal deploy, con `protocolVersion: "3"`, ABI, indirizzo, chainId, blocco e hash iniziali. Sono disponibili `fixtures/planner.synthetic.json` e `npm run fixtures` per esportare gli eventi Hardhat; non usare il nome dimostrativo di un punto come prova delle sue coordinate.
3. **Storico implementato:** usare [TRANSAZIONI_SIMULATE.md](TRANSAZIONI_SIMULATE.md) e `npm run simulate:history`. Il dataset di 180 giorni/5.000 operazioni è in `data/simulated/history-v1`, con eventi, ricevute, aggregati, schede RAG e 20 domande attese. L’indicizzazione QVAC rimane da realizzare. Requisiti rispettati dallo script Hardhat riproducibile: seed casuale fisso, wallet cliente fittizi anche con zero ETH, operatori di macchinette e negozi finanziati con ETH locali, i 10 bidoni e 6 negozi già definiti nel contratto, 180 giorni simulati, circa 5.000 operazioni. Eseguire mint e acquisti sul contratto locale: il cliente firma `PurchaseAuthorization`, il negozio firma `Purchase` e il suo operatore invia `purchase` pagando il gas. Rispettare saldo, entrambe le firme, nonce e scadenze; impostare il tempo prima di firmare preventivi di acquisto. Per lo storico con date simulate generare direttamente le firme contro il timestamp del blocco più 300 secondi e usare gli helper condivisi; l’API interattiva usa anche l’orologio del server e non è un generatore di storico retrodatato. Generare anche periodi di calo, crescita, punti disattivati e quartieri senza installazioni. Nessuna assunzione sui comportamenti simulati deve essere presentata come proprietà reale dei quartieri torinesi.
4. Implementare indicizzatore, query, ranking e retrieval vettoriale QVAC versionato; confrontare i risultati con gli eventi generati. Tenere separati dati del simulatore e fonti pubbliche.
5. Aggiungere accesso riservato, backend DeepSeek e chat React. Mostrare risultati strutturati, fonti e stato di sincronizzazione; mantenere classifica consultabile quando l'API è indisponibile.
6. Consegnare `.env.example`, lockfile, istruzioni locali e comandi: import dati, avvio nodo, deploy, generazione storico, sincronizzazione e avvio planner. Non includere segreti o chiavi di wallet non dimostrative.

## Collegamento al modulo operativo

- Contratto e API aggiornati: [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md); comandi, payload, stati e passaggio dal vecchio deploy: [AVVIO.md](AVVIO.md).
- Con il backend attivo, `GET /api/config` restituisce il manifest dentro `deployment`. Per il planner bastano manifest e RPC; non servono chiavi dei terminali.
- Per la demo interattiva: `POST /api/purchase-quotes` → firma buyer con `buyerAuthorization(quote, manifest)` → `POST /api/purchases` con `{ quote, buyerSignature }` → recupero dello stato fino a receipt riuscita. Non inviare l’acquisto dal wallet del cliente.
- Per uno script che genera direttamente le transazioni usare `purchaseArgs(quote, buyerSignature)` e il wallet dell’operatore del negozio. Il campo `quote.signature` contiene la firma del negozio. Per lo storico si possono costruire i preventivi in memoria; non inserire le chiavi negli strumenti disponibili all’AI.
- La rete di punti è fissa; ogni evento contiene `neighborhoodId` e `zoneId`. Il catalogo condiviso riporta nomi e codici dei quartieri. Non aggiungere punti, non sostituire il quartiere con la circoscrizione e non inventare coordinate o zone statistiche dai soli nomi.
- Dopo nuovo deploy o reset rigenerare il manifest, ricostruire l’indice blockchain e aggiornare lo snapshot usato dal RAG. `npm run fixtures` è un’esportazione fino a `latest`, non l’indicizzatore persistente con conferme e rollback.

## Test necessari

- Import: codici `09bis`/`17bis`, residenza virtuale esclusa dal ranking, somme demografiche, valori IDISE soppressi, anni diversi e join geografici ambigui.
- Blockchain: cliente a zero ETH con acquisto riuscito e gas addebitato al negozio; firma buyer mancante/falsificata respinta; wallet distinti derivati da `PurchaseCompleted.buyer`, non da `transaction.from`; due sincronizzazioni non duplicano log, revert non produce acquisti, deattivazioni modificano l'esposizione, reset e rollback ricostruiscono l'indice.
- Ranking: determinismo a parità di dati/pesi; variazione dei pesi produce contributi coerenti; zero installazioni non implica domanda zero; top 3 senza duplicati di quartiere; nessuna proposta con dati inventati o ID sconosciuti.
- Chat: almeno 20 domande con risposte attese dai dati, includendo confronti, andamento, raccomandazioni, fonti, richieste ambigue e dati assenti. Verificare che ogni numero mostrato corrisponda ai risultati degli strumenti e valutare manualmente le motivazioni.
- Accesso/costi: richieste senza sessione respinte, chiave mai nel bundle frontend, limitazioni operative rispettate, budget e timeout gestiti, nessuna funzione di scrittura su blockchain disponibile al modello.

## Dimostrazione conclusiva

Un gestore entra e chiede dove installare un nuovo punto. La chat restituisce fino a tre quartieri con sottozona verificata, categoria espansione/pilota, indicatori, fonti/anni e flag di simulazione. Alla domanda “perché questa zona?” recupera evidenze coerenti. Cambiando priorità ricalcola i risultati. Con dati insufficienti lo dichiara senza fabbricare la terza proposta.

## Stato dei lavori

Aggiornamento del 4 novembre 2026:

| Parte                                                                                   | Stato                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Contratto RCS, 10 bidoni fissi e 6 negozi fissi                                         | Implementati, protocollo `3`                                                                      |
| Backend depositi, preventivi e acquisti con gas del negozio                             | Implementato, con persistenza e recupero senza transazioni duplicate                              |
| Pagine React macchinetta/supermercato e firma del cliente                               | Implementate, con supporto a clienti senza ETH                                                    |
| Deploy Hardhat, manifest, reset, demo e fixture                                         | Disponibili; la nuova versione richiede un nuovo deploy                                           |
| Verifiche del modulo operativo                                                          | 39 test automatici superati, typecheck e build riusciti; MetaMask reale da collaudare manualmente |
| Archivio QVAC ed esempio CLI                                                            | Già presenti e conservati                                                                         |
| Dataset originali                                                                       | Scaricati; per lo stato dei file seguire [DATA_PIPELINE.md](DATA_PIPELINE.md#stato-verificato)    |
| Storico blockchain simulato di 180 giorni e 5.000 operazioni | Generatore ed export disponibili; schede RAG e 20 domande di valutazione in [TRANSAZIONI_SIMULATE.md](TRANSAZIONI_SIMULATE.md) |
| Importazioni delle fonti pubbliche, raccordi geografici più fini e indicizzatore persistente | Da implementare nel modulo del planner |
| Modello embedding QVAC, retrieval versionato, ranking e chat DeepSeek riservata         | Da implementare e collaudare secondo le specifiche dedicate                                       |

I risultati dei test del modulo operativo non certificano il planner, il ranking o il RAG. Il confronto degli aggregati con l’indicizzatore del collega resta una verifica di integrazione da eseguire quando sarà disponibile.
