# Dataset Riciclo Solidale

Gli originali sono destinati a `raw/`. `download_manifest.json` distingue file disponibili e download falliti, con URL, anno di riferimento, errore ed eventuale checksum SHA-256.

Per scaricare o riprovare tutti i 17 file selezionati:

```sh
python3 scripts/download_datasets.py
```

Lo script conserva gli originali, verifica archivi ZIP e intestazioni PDF, rifiuta pagine HTML al posto dei CSV e non estrae automaticamente gli archivi. I controlli di formato non equivalgono alla validazione degli schemi e dei contenuti statistici. I file già disponibili e validi vengono riutilizzati.

## Selezione

- Popolazione per 23 quartieri e zone statistiche nel 2025, più popolazione per età/circoscrizione e famiglie.
- Assistenza economica e servizi sociali Torino 2024, tavole 7.1 e 7.2.
- IDISE Piemonte 2023, dati e documentazione metodologica. Nel pacchetto regionale selezionare la cartella di Torino, codice Istat 001272.
- Confini degli ex-quartieri, delle zone statistiche e delle circoscrizioni.
- Attività commerciali geolocalizzate: negozi potenziali, non convenzioni già attive.
- Strutture socio-assistenziali: fonte con revisione dichiarata 2013, da verificare prima di usarla come elenco attuale.
- Servizi sociali territoriali Piemonte, dati 2024, edizione 2026: contesto per il RAG, non dati di quartiere.

## Vincoli di analisi

Quartieri, zone statistiche e circoscrizioni sono livelli diversi: verificare i codici e le corrispondenze geografiche prima dei join. I dati circoscrizionali non diventano dati di quartiere dividendoli per popolazione. Conservare separata la residenza virtuale; fino al 2023 era inclusa nel Centro/circoscrizione 1.

IDISE 2023 è confrontabile tra aree dello stesso comune e anno, non direttamente con IDISE 2021. I valori mancanti o non diffusi non sono zeri. Verificare nel tracciato record il campo di osservazione di ogni indicatore. Le revisioni dei confini non coincidono con la data di osservazione dei dati sociali.

Le schede geografiche consultate indicano CC BY 4.0: conservare attribuzione e verificare per ogni archivio la documentazione/licenza allegata. Non attribuire una licenza unica a tutti i file senza verifica.
