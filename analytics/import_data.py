"""Importazioni locali: originali immutati, provenienza e transazioni atomiche."""
import argparse
import csv
import hashlib
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARSER_VERSION = "demography-v1"


def area_code(value):
    text = str(value).strip().lower()
    match = re.fullmatch(r"(\d+)(bis)?", text)
    if not match:
        raise ValueError(f"Codice territoriale non valido: {value!r}")
    number, suffix = match.groups()
    # Stable IDs preserve the published suffix, including the leading zero in 09bis.
    return (str(int(number)).zfill(2) + suffix) if suffix else str(int(number))


def count(value):
    text = str(value).strip()
    if not re.fullmatch(r"\d+", text):
        raise ValueError(f"Conteggio demografico non valido: {value!r}")
    return int(text)


def read_population(path, kind):
    code_key, name_key = {
        "neighborhood": ("num_quartiere", "desc_quartiere"),
        "zone": ("Num_zona_stat", "Desc_zona_stat"),
    }[kind]
    result = []
    seen = set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        required = {code_key, name_key, "femmine", "maschi"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Colonne mancanti in {path.name}")
        for row in reader:
            code = area_code(row[code_key])
            if code in seen:
                raise ValueError(f"Codice duplicato in {path.name}: {code}")
            seen.add(code)
            female, male = count(row["femmine"]), count(row["maschi"])
            name = row[name_key].strip()
            if not name:
                raise ValueError(f"Nome territoriale vuoto: {code}")
            result.append((kind, code, name, female, male, female + male, 2025, int(code != "0")))
    return result


def import_demography(root=ROOT, db_path=None):
    db_path = Path(db_path or root / "data/processed/planner.sqlite")
    manifest = json.loads((root / "data/download_manifest.json").read_text())
    sources = {item["file"]: item for item in manifest["datasets"]}
    batches = []
    for filename, kind, expected in [
        ("popolazione_quartieri_2025.csv", "neighborhood", 24),
        ("popolazione_zone_statistiche_2025.csv", "zone", 95),
    ]:
        path = root / "data/raw" / filename
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        source = sources[filename]
        if source.get("sha256") and source["sha256"] != digest:
            raise ValueError(f"Checksum diverso dal manifest: {filename}")
        rows = read_population(path, kind)
        if len(rows) != expected or sum(row[5] for row in rows) != 863249:
            raise ValueError(f"Conteggi o somma demografica inattesi: {filename}")
        if sum(row[1] == "0" for row in rows) != 1:
            raise ValueError(f"Residenza virtuale assente: {filename}")
        batches.append((filename, digest, source, rows))

    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS dataset_sources (
                sha256 TEXT PRIMARY KEY, filename TEXT NOT NULL, url TEXT NOT NULL,
                acquired_at TEXT, observed_year INTEGER NOT NULL,
                parser_version TEXT NOT NULL, license_status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS demographics (
                kind TEXT NOT NULL, area_id TEXT NOT NULL, name TEXT NOT NULL,
                female INTEGER NOT NULL, male INTEGER NOT NULL, population INTEGER NOT NULL,
                year INTEGER NOT NULL, geographic INTEGER NOT NULL,
                source_sha256 TEXT NOT NULL REFERENCES dataset_sources(sha256),
                PRIMARY KEY (kind, area_id, year),
                CHECK (population = female + male), CHECK (female >= 0 AND male >= 0)
            );
        """)
        for filename, digest, source, rows in batches:
            db.execute("""INSERT OR IGNORE INTO dataset_sources VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (digest, filename, source["url"], manifest.get("attempted_at"),
                        2025, PARSER_VERSION, "requires-source-license-verification"))
            db.executemany("""INSERT INTO demographics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(kind, area_id, year) DO UPDATE SET
                name=excluded.name, female=excluded.female, male=excluded.male,
                population=excluded.population, geographic=excluded.geographic,
                source_sha256=excluded.source_sha256""", [(*row, digest) for row in rows])
    return {
        "parser_version": PARSER_VERSION,
        "population_total_including_virtual": 863249,
        "datasets": [{"file": name, "sha256": digest, "rows": len(rows),
                      "geographic_rows": sum(row[7] for row in rows)}
                     for name, digest, _, rows in batches],
        "limitations": ["Questa sezione del report riguarda soltanto l'importazione demografica.",
                        "Licenze delle fonti da verificare prima della distribuzione."],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "data/processed/planner.sqlite")
    args = parser.parse_args()
    report = import_demography(db_path=args.database)
    report_path = args.database.with_suffix(".quality.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))
