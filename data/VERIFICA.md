# Verifica dei download — 4 novembre 2026

## Esito

Confermati 11 originali disponibili su 17. Tutti i checksum SHA-256 coincidono con il manifest dell'ultimo download dell'utente. Il manifest è conservato come testimonianza del tentativo originale.

- 4 CSV leggibili, separatore punto e virgola: popolazione per quartiere (24 record), popolazione per zona statistica (95 record), popolazione per età/circoscrizione (109 record), famiglie per numero componenti/circoscrizione (17 record).
- I record demografici comprendono una riga separata di residenza virtuale: non è un ulteriore quartiere o zona fisica. Entrambe le tabelle territoriali sommano a 863.249 residenti.
- 6 PDF apribili con pdfinfo: popolazione quartieri 1 pagina; famiglie tipologia 2; assistenza economica 23; nota informativa IDISE 9; nota metodologica IDISE 12; servizi sociali Piemonte 58.
- Archivio IDISE: verifica CRC riuscita per tutti i 468 elementi. Presente `001272_Torino/001272_Torino.xlsx`, con fogli ASC_2023, ADU_2023 e ADU_SEZ, rispettivamente 97, 20 e 321 righe XML, intestazioni incluse. Non sono conteggi di osservazioni valide: le righe richiedono ancora interpretazione tramite tracciato record.

La cartella originale di Torino è estratta in `extracted/001272_Torino/`, con Excel e mappa HTML e relativi file di supporto. Nessuna trasformazione dei valori è stata applicata.

## Sei file mancanti

Tutti i fallimenti del manifest riguardano lo stesso host e riportano SSL UNEXPECTED_EOF_WHILE_READING:

- ex_quartieri.zip
- zone_statistiche_geo.zip
- zone_statistiche_csv.zip
- circoscrizioni_geo.zip
- attivita_commerciali_geo.zip
- strutture_socio_assistenziali_csv.zip

Lo script usava HTTPS per gli archivi geografici, mentre i collegamenti di download pubblicati nelle schede del catalogo utilizzano HTTP. Aggiornata la base URL a HTTP, senza disabilitare la verifica dei certificati HTTPS per le altre fonti. Il funzionamento dell'alternativa deve ancora essere verificato dalla rete dell'utente: nell'ambiente dell'assistente il dominio non è risolvibile neppure via HTTP.

Per riprovare dalla radice del progetto:

```sh
python3 scripts/download_datasets.py
```

I file presenti e validi vengono riutilizzati; il nuovo tentativo scarica soltanto i mancanti e aggiorna il manifest. Se il server reindirizza a HTTPS e fallisce ancora, servono endpoint alternativi del Geoportale.

## Pronti per cosa

Sono disponibili i dati statistici per iniziare l'analisi e il prototipo della chat. Restano da validare gli indicatori IDISE, i codici di raccordo e i valori mancanti. Senza gli archivi geografici non è ancora verificato l'abbinamento completo tra quartieri, zone statistiche e punti del progetto; il registro dei punti deve includere coordinate.
