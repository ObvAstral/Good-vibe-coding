"""Evidenze descrittive e partner potenziali, separati dalle affiliazioni attive."""
import argparse
import hashlib
import json
import sqlite3
import subprocess
from pathlib import Path

import geopandas as gpd

from import_data import ROOT, area_code


def import_context(db_path):
    manifest = json.loads((ROOT / 'data/download_manifest.json').read_text())
    sources = {r['file']: r for r in manifest['datasets']}
    frame = gpd.read_file(f"zip://{ROOT / 'data/raw/attivita_commerciali_geo.zip'}").to_crs(4326)
    # Explicit whitelist based on observed categories. No assumption of current activity.
    food = frame[frame.TIPO_MER.isin(['ALIMENTARI', 'MISTA']) & frame.DESC_RIP.isin(['PICCOLE STRUTTURE', 'MEDIE STRUTTURE', 'GRANDI STRUTTURE'])].copy()
    food['key'] = food.apply(lambda r: json.dumps([str(r.INDIRIZZ).strip(), str(r.INSEGNA), str(r.TIPO_MER), round(r.geometry.x, 7), round(r.geometry.y, 7)], ensure_ascii=False), axis=1)
    food = food.drop_duplicates('key')
    records = []
    for row in food.itertuples():
        records.append((hashlib.sha256(row.key.encode()).hexdigest(), str(row.INDIRIZZ).strip(),
                        str(row.TIPO_MER), area_code(row.ZONASTAT) if str(row.ZONASTAT).strip() not in ['', '.', 'nan'] else None,
                        row.geometry.y, row.geometry.x))
    documents = []
    filenames = ['idise_nota_informativa_2023.pdf', 'idise_nota_metodologica_2023.pdf',
                 'assistenza_economica_servizi_sociali_2024.pdf', 'famiglie_tipologia_circoscrizioni_2025.pdf',
                 'servizi_sociali_piemonte_2024.pdf']
    digests = {}
    for name in ['attivita_commerciali_geo.zip', *filenames]:
        digest = hashlib.sha256((ROOT / 'data/raw' / name).read_bytes()).hexdigest()
        if sources[name].get('sha256') and sources[name]['sha256'] != digest:
            raise ValueError('Checksum diverso: ' + name)
        digests[name] = digest
    for name in filenames:
        text = subprocess.check_output(['pdftotext', '-layout', str(ROOT / 'data/raw' / name), '-'], text=True)
        year = 2023 if name.startswith('idise') else 2025 if name.startswith('famiglie') else 2024
        for page, content in enumerate(text.split('\f'), 1):
            # Prose only. Tabular values need manual validation and are not imported as indicators.
            lines = [' '.join(line.split()) for line in content.splitlines()
                     if len(line.split()) >= 6 and sum(c.isdigit() for c in line) / max(1, len(line)) < 0.03
                     and not any(c.isdigit() for c in line)]
            for i, line in enumerate(lines):
                if len(line) < 45:
                    continue
                source = f'dataset:{digests[name]}'
                documents.append((f'pdf:{digests[name]}:p{page}:{i}',
                                  f'{name}, pagina {page}. Contesto descrittivo; dati territoriali non imputabili ai quartieri. {line}', year, source))
    with sqlite3.connect(db_path) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS potential_partners (id TEXT PRIMARY KEY,address TEXT,category TEXT,zone_id TEXT,latitude REAL,longitude REAL);
          CREATE TABLE IF NOT EXISTS context_evidence (id TEXT PRIMARY KEY,content TEXT NOT NULL,year INTEGER NOT NULL,source TEXT NOT NULL);
        ''')
        for name, digest in digests.items():
            db.execute('INSERT OR IGNORE INTO dataset_sources VALUES (?,?,?,?,?,?,?)',
                       (digest, name, sources[name]['url'], manifest.get('attempted_at'),
                        2023 if name.startswith('idise') else 2025 if name.startswith('famiglie') else 2024 if name.endswith('.pdf') else 0,
                        'context-v1', 'requires-source-license-verification'))
        db.execute('DELETE FROM potential_partners')
        db.executemany('INSERT INTO potential_partners VALUES (?,?,?,?,?,?)', records)
        db.execute('DELETE FROM context_evidence')
        db.executemany('INSERT INTO context_evidence VALUES (?,?,?,?)', documents)
    return {'potential_food_partners': len(records), 'prose_chunks': len(documents), 'table_values_imported': False,
            'whitelist': {'TIPO_MER': ['ALIMENTARI', 'MISTA'], 'DESC_RIP': ['PICCOLE STRUTTURE', 'MEDIE STRUTTURE', 'GRANDI STRUTTURE']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default=str(ROOT / 'data/processed/planner.sqlite'))
    args = parser.parse_args()
    print(json.dumps(import_context(args.database), ensure_ascii=False, indent=2))
