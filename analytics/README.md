# Base dati del planner

Prerequisiti: Python 3.12–3.14 e `uv`. Le dipendenze Python sono fissate in
`uv.lock`; gli originali in `data/raw/` non vengono modificati.

Dalla radice del repository:

```sh
uv sync --project analytics --locked --python 3.12
npm run analytics:import
npm run test:ai
```

L'importazione crea `data/processed/planner.sqlite` in modalità WAL e il report
`data/processed/planner.geography.json`. Per un database diverso:

```sh
uv run --project analytics --locked python analytics/geography.py --database /tmp/planner.sqlite
```

Sono disponibili demografia 2025, geometrie dei 23 quartieri e delle 94 zone,
raccordo per massima superficie e 89 IDISE 2023 pubblicati. I quartieri sono la
divisione pubblica concordata: per esempio Crocetta e Pozzo Strada. Quote di
sovrapposizione e attraversamenti restano nel database e nel report. I cinque
IDISE mancanti restano null; il totale comunale e la sezione fittizia dell'Excel
non diventano zone. Il totale demografico di 863.249 comprende la residenza
virtuale, conservata nei dati ma esclusa dalla geografia.

Un secondo import aggiorna le stesse chiavi senza duplicati. Il raccordo ASC
controlla anche le denominazioni contro lo shapefile, comprese le eccezioni
09bis e 17bis. Le licenze sono registrate come da verificare: nessuna licenza
globale viene attribuita implicitamente ai dataset.

Gli indicatori IDISE conservano la propria granularità di zona statistica.
`analytics:context` importa anche record commerciali alimentari/misti deduplicati
ed evidenze descrittive dai PDF, con riferimenti di pagina. `planner:points`
collega le coordinate dei punti del collega ai quartieri, per deployment.
Per eventi blockchain, ranking e chat vedere `planner/GUIDA.md`.
