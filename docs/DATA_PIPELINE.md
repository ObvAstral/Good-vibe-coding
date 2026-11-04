# Pipeline dati e raccomandazioni territoriali

## Stato verificato

Tutti i 17 file originali del manifest sono disponibili in `data/raw/`: checksum confrontati, ZIP verificati con CRC, PDF leggibili e CSV parsabili. Il precedente `data/VERIFICA.md` descrive il tentativo a 11/17 ed è storico, non lo stato attuale. Lo ZIP IDISE contiene Torino e i fogli ASC_2023, ADU_2023 e ADU_SEZ; la copia estratta è in `data/extracted/001272_Torino/`.

Confini: 23 quartieri (IDQUART), 94 zone statistiche (ZONASTAT), 8 circoscrizioni (NCIRCO). I codici dei quartieri coincidono con la popolazione annuale; quelli delle zone statistiche coincidono dopo normalizzazione degli zeri iniziali, preservando i suffissi `09bis` e `17bis`. Non convertire tutti i codici in interi.

Dati commerciali: 31.271 record con attributi merceologici, indirizzi, geometrie puntuali, ZONASTAT e NCIRCO. Strutture sociali: 151 record, classificazioni UTENZA e DIUR_RES, coordinate e zona statistica; revisione dichiarata 2013, da verificare. Questi numeri sono record, non necessariamente attività attive o servizi distinti.

## Importazioni

Conservare gli originali immutati e l'attribuzione delle fonti. Ogni importazione registra SHA-256, fonte, data di acquisizione, anno osservato, unità territoriale, versione del parser e licenza verificata. Scrivere tabelle normalizzate e un report di qualità; import ripetuto degli stessi hash non duplica dati.

1. CSV demografici: separatore `;`, utf-8-sig, nomi ripuliti dagli spazi. Totale quartiere = femmine + maschi. Residenza virtuale codice 0 resta fuori dalla geografia e dal ranking. Popolazione territoriale e virtuale insieme sommano a 863.249 nel 2025.
2. Geometrie: leggere PRJ, non presumere WGS84. Convertire in EPSG:4326 per visualizzazione e in un CRS metrico locale per operazioni geometriche. Validare geometrie, duplicati e chiavi.
3. IDISE: selezionare Torino, codice ISTAT 001272; usare il tracciato record per trovare codici, etichette, unità e valori mancanti. Non dedurre colonne dall'ordine o trasformare valori soppressi in zero. I dati sociali si riferiscono al 2023, non al 2026 di pubblicazione.
4. Collegare ASC a zone statistiche tramite codici documentati; rendicontare ogni mancato raccordo. Collegare zone statistiche e quartieri tramite geometrie: verificare quali zone sono interamente contenute. Per zone che attraversano confini non distribuire indicatori sociali per area geometrica; conservare il dettaglio di zona e segnalare il quartiere interessato.
5. Attività commerciali: deduplicare usando attributi e coordinate; esaminare i valori effettivi delle classificazioni per definire una whitelist documentata delle attività alimentari. Sono partner potenziali, non affiliati: la rete attiva deriva dal registro del progetto.
6. PDF di assistenza economica e famiglie: estrarre tabelle con riferimento a pagina/tavola, controllare a mano contro l'originale. Questi dati sono circoscrizionali e restano contesto, non valori imputati ai singoli quartieri. Le strutture 2013 e le pubblicazioni regionali restano evidenze descrittive, escluse dal punteggio operativo iniziale.

Non confrontare direttamente IDISE 2021 e 2023: il riferimento comunale cambia. Non sommare sottotipi sovrapposti di assistiti. Non dedurre anziani soli combinando separatamente distribuzione per età e famiglie monocomponenti.

## Registro dei punti e blockchain

Usare gli eventi già definiti in INTERFACCIA_PLANNER.md, via RPC Hardhat. Un solo nodo RPC basta per leggere la stessa catena. Il manifest `deployments/local.json` espone il protocollo `2`, rete, contratto, ABI, blocco e hash iniziali; è generato dal deploy del modulo già implementato. Vedi [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md#aggiornamento-per-i-colleghi--protocollo-2) per la consegna operativa.

Nel protocollo `2` il cliente autorizza l’acquisto con una firma, mentre il supermercato invia la transazione e paga il gas. Per i distinti e le analisi usare il campo `buyer` di `PurchaseCompleted`: `transaction.from` identifica il negozio. Le firme degli eventi non cambiano.

Il registro aggiunge a ogni pointId coordinate verificate e posizione versionata per deployment; ricavare quartiere e zona statistica con point-in-polygon. Il codice di circoscrizione dell'evento non consente da solo di assegnare il quartiere. Se un punto si sposta, creare un nuovo ID come già previsto dal contratto. Per coordinate mancanti conservare le operazioni nei totali, escludendole dalle analisi di quartiere.

Indicizzazione: deduplicare log con chainId/contractAddress/transactionHash/logIndex, salvare blockHash e timestamp UTC, gestire rollback come nella specifica precedente. Sulla rete locale la soglia di due blocchi può ritardare l'ultima operazione: rendere visibile il ritardo e prevedere il mining dei blocchi aggiuntivi negli script demo. Un reset Hardhat invalida l'indice del deployment precedente.

Aggregare per punto, zona e giorno UTC: conferimenti, bottiglie, token emessi, acquisti, token bruciati, wallet distinti. I distinti di finestre diverse si ricalcolano dai log, non si sommano. Normalizzare l'utilizzo per giorni di punto abilitato; non chiamarli giorni di effettivo funzionamento senza telemetria hardware. Non interpretare emissioni meno burn in un quartiere come saldo dei residenti.

## Metodo di ranking iniziale

Periodo predefinito: ultimi 30 giorni simulati conclusi; confronto con i 30 precedenti. Riferire l'orologio del periodo all'ultimo blocco indicizzato, non all'orologio reale del PC. Dichiarare sempre che lo storico locale è sintetico.

Produrre due graduatorie: espansione nelle aree con utilizzo osservato e installazioni pilota nelle aree ancora senza osservazioni. Non attribuire domanda zero a un'area senza macchinette. Non presentare utilizzo elevato come prova di saturazione o impatto causale di nuove installazioni.

Unità di analisi iniziale: zona statistica con dati sociali pubblicati e popolazione valida. Associare il risultato al quartiere quando la corrispondenza geografica è verificata; scegliere al massimo una proposta per quartiere, ordinando i quartieri secondo la migliore zona candidata contenuta. Esporre che il punteggio riguarda quella sottozona, non l'intero quartiere. Non inventare un valore sociale di quartiere se non si dispone di basi per aggregarlo correttamente.

Default espliciti di priorità (pesi di progetto, non pesi scientificamente validati):

- B = bisogno/copertura: 50% percentile IDISE 2023 e 50% percentile del gap di copertura, definito come popolazione / (1 + macchinette attive).
- U = utilizzo osservato: percentile dei conferimenti / giorni-punto abilitati nella finestra. Richiedere almeno 14 giorni-punto osservati. Evidenziare separatamente trend e presenza di negozi affiliati, senza inventare capacità o distanze percorribili.
- Profilo balanced: 0,5 B + 0,5 U; social: 0,75 B + 0,25 U; usage: 0,25 B + 0,75 U. Esprimere i percentili 0–100, assegnando rango medio ai pari merito. Parità finale risolta per codice stabile, dichiarandola come tale.

Le zone senza U sufficiente ricevono solo B e l'etichetta pilota/dati insufficienti, senza essere messe in classifica come se avessero un punteggio completo. Per la top 3: fino a due proposte di espansione e una pilota; se mancano candidati di un gruppo completare con l'altro fino a tre quartieri distinti. Presentare le due categorie separatamente, senza confrontare numericamente B con il punteggio completo.

Per quartieri con IDISE assente, non classificare il bisogno sociale: mostrarli in una lista di approfondimento con i dati disponibili. In assenza completa di storico, produrre soltanto proposte pilota. Evidenziare se mancano negozi affiliati: suggerire una verifica della rete di spesa, senza dichiarare impossibile un uso oltre confine.

## Retrieval

Creare schede per zona/quartiere e periodo con indicatori già calcolati, anni/fonti, provenienza sintetica, copertura e limiti. Separare schede osservazionali da note metodologiche. Ogni scheda ha ID stabile e versione; il retrieval filtra periodo e territorio. Gli aggregati globali e la top 3 provengono sempre da query sul database completo, non dal top-k di una ricerca testuale.

La ricerca delle schede usa embedding e workspace QVAC, secondo [RAG_QVAC_DEEPSEEK.md](RAG_QVAC_DEEPSEEK.md). SQLite conserva i metadati e il collegamento tra ID vettoriali e fonti.
