# Ordine di lavoro e accettazione

Leggere prima [RAG_QVAC_DEEPSEEK.md](RAG_QVAC_DEEPSEEK.md), poi [AI_E_DATI.md](AI_E_DATI.md) e [DATA_PIPELINE.md](DATA_PIPELINE.md). Implementare il modulo del collega senza modificare emissione e burn del simulatore.

## Sequenza

1. Verificare prima il modello embedding multilingue sul worker QVAC e la ricerca locale come descritto nella guida RAG. Importare e validare dataset e geometrie; produrre SQLite, report dei raccordi e schede con fonti. Non aspettare il contratto per questa attività.
2. Collegare il registro dei punti alle coordinate; confermare ABI/manifest con il collega del contratto. Preparare fixture degli eventi concordati finché il contratto non è disponibile.
3. Preparare script Hardhat riproducibile: seed casuale fisso, wallet fittizi finanziati con ETH locali, macchinette e negozi in quartieri distinti, 180 giorni simulati, circa 5.000 operazioni. Eseguire mint e acquisti reali sul contratto locale, rispettando saldo, firme, nonce e scadenze; impostare il tempo prima di firmare preventivi di acquisto. Generare anche periodi di calo, crescita, punti disattivati e quartieri senza installazioni. Nessuna assunzione sui comportamenti simulati deve essere presentata come proprietà reale dei quartieri torinesi.
4. Implementare indicizzatore, query, ranking e retrieval vettoriale QVAC versionato; confrontare i risultati con gli eventi generati. Tenere separati dati del simulatore e fonti pubbliche.
5. Aggiungere accesso riservato, backend DeepSeek e chat React. Mostrare risultati strutturati, fonti e stato di sincronizzazione; mantenere classifica consultabile quando l'API è indisponibile.
6. Consegnare `.env.example`, lockfile, istruzioni locali e comandi: import dati, avvio nodo, deploy, generazione storico, sincronizzazione e avvio planner. Non includere segreti o chiavi di wallet non dimostrative.

## Test necessari

- Import: codici `09bis`/`17bis`, residenza virtuale esclusa dal ranking, somme demografiche, valori IDISE soppressi, anni diversi e join geografici ambigui.
- Blockchain: due sincronizzazioni non duplicano log, revert non produce acquisti, deattivazioni modificano l'esposizione, reset e rollback ricostruiscono l'indice.
- Ranking: determinismo a parità di dati/pesi; variazione dei pesi produce contributi coerenti; zero installazioni non implica domanda zero; top 3 senza duplicati di quartiere; nessuna proposta con dati inventati o ID sconosciuti.
- Chat: almeno 20 domande con risposte attese dai dati, includendo confronti, andamento, raccomandazioni, fonti, richieste ambigue e dati assenti. Verificare che ogni numero mostrato corrisponda ai risultati degli strumenti e valutare manualmente le motivazioni.
- Accesso/costi: richieste senza sessione respinte, chiave mai nel bundle frontend, limitazioni operative rispettate, budget e timeout gestiti, nessuna funzione di scrittura su blockchain disponibile al modello.

## Dimostrazione conclusiva

Un gestore entra e chiede dove installare un nuovo punto. La chat restituisce fino a tre quartieri con sottozona verificata, categoria espansione/pilota, indicatori, fonti/anni e flag di simulazione. Alla domanda “perché questa zona?” recupera evidenze coerenti. Cambiando priorità ricalcola i risultati. Con dati insufficienti lo dichiara senza fabbricare la terza proposta.

## Stato dei lavori

Esistono archivio SDK QVAC, esempio CLI, documentazione e dataset scaricati. Non risultano ancora implementati contratto, simulatore React, indicizzatore, importazioni normalizzate, ranking e chat interna: questa documentazione è la specifica di consegna, non la certificazione di tali funzionalità.
