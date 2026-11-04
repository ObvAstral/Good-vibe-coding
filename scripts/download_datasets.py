"""Scarica gli originali selezionati, valida i formati e registra gli esiti."""
import concurrent.futures
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://www.comune.torino.it/media/'
# Il catalogo pubblica questi archivi via HTTP; HTTPS fallisce su questo host.
GEO = 'http://geoportale.comune.torino.it/geodati/zip/'
SOURCES = [
 ('popolazione_quartieri_2025.csv', BASE+'10258', '2025'),
 ('popolazione_quartieri_2025.pdf', BASE+'10259', '2025'),
 ('popolazione_zone_statistiche_2025.csv', BASE+'9694', '2025'),
 ('popolazione_eta_circoscrizioni_2025.csv', BASE+'9707', '2025'),
 ('famiglie_componenti_circoscrizioni_2025.csv', BASE+'9723', '2025'),
 ('famiglie_tipologia_circoscrizioni_2025.pdf', BASE+'9719', '2025'),
 ('assistenza_economica_servizi_sociali_2024.pdf', BASE+'8355', '2024'),
 ('idise_piemonte_2023.zip', 'https://www.istat.it/wp-content/uploads/2026/10/R01_Piemonte_IDISE_2023.zip', '2023'),
 ('idise_nota_informativa_2023.pdf', 'https://www.istat.it/wp-content/uploads/2025/12/Nota-Informativa-idise-2023.pdf', '2023'),
 ('idise_nota_metodologica_2023.pdf', 'https://www.istat.it/wp-content/uploads/2025/12/Nota-Metodologica-idise-2023.pdf', '2023'),
 ('ex_quartieri.zip', GEO+'ex_quartieri.zip', 'confini storici; metadati 2025'),
 ('zone_statistiche_geo.zip', GEO+'zone_statistiche_geo.zip', 'revisione 2024'),
 ('zone_statistiche_csv.zip', GEO+'zone_statistiche_csv.zip', 'revisione 2024'),
 ('circoscrizioni_geo.zip', GEO+'circoscrizioni_geo.zip', 'confini'),
 ('attivita_commerciali_geo.zip', GEO+'attivita_commerciali_geo.zip', 'revisione 2025'),
 ('strutture_socio_assistenziali_csv.zip', GEO+'strutture_socio_assistenziali_csv.zip', 'revisione dichiarata 2013; da verificare'),
 ('servizi_sociali_piemonte_2024.pdf', 'https://www.regione.piemonte.it/web/media/57686/download', '2024; edizione 2026'),
]

def validate(name, data):
    if not data:
        raise ValueError('Risposta vuota')
    if name.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            bad = archive.testzip()
            if bad:
                raise ValueError('Archivio corrotto: '+bad)
    elif name.endswith('.pdf'):
        if not data.startswith(b'%PDF-'):
            raise ValueError('Risposta non PDF')
    else:
        sample = data[:4096].decode('utf-8-sig', errors='replace').lower().lstrip()
        if '<html' in sample or '<!doctype' in sample or sample.startswith('%pdf'):
            raise ValueError('Risposta non CSV')
        if not any(separator in sample for separator in (';', ',', '\t')):
            raise ValueError('Separatore CSV non rilevato')


def download(source):
    name, url, year = source
    record = dict(file=name, url=url, reference=year)
    path = ROOT/'data'/'raw'/name
    try:
        if path.exists():
            data = path.read_bytes()
            validate(name, data)
            record['status'] = 'available'
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'RicicloSolidale-dataset-downloader/1.0'})
            with urllib.request.urlopen(request, timeout=25) as response:
                data = response.read()
                record['resolved_url'] = response.url
            validate(name, data)
            temporary = path.with_suffix(path.suffix+'.part')
            temporary.write_bytes(data)
            temporary.replace(path)
            record['status'] = 'downloaded'
        record.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    except Exception as error:
        record.update(status='failed', error=str(error))
    print(record['status'], name, flush=True)
    return record

if __name__ == '__main__':
    (ROOT/'data'/'raw').mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(download, SOURCES))
    manifest = dict(attempted_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), datasets=results)
    (ROOT/'data'/'download_manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n')
    succeeded = sum(r['status'] != 'failed' for r in results)
    print(f'Disponibili {succeeded}/{len(results)} file.')
    raise SystemExit(0 if succeeded == len(results) else 1)
