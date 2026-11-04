"""Quartieri come divisione pubblica; zone statistiche conservate come evidenze."""
import argparse
import hashlib
import io
import json
import math
import sqlite3
import unicodedata
import zipfile

import geopandas as gpd
import pandas as pd

from import_data import ROOT, area_code, import_demography

PARSER_VERSION = "neighborhood-geography-v1"
METHOD = "largest-area-overlap"
METRIC_CRS = "EPSG:32632"


def label(value):
    return " ".join(unicodedata.normalize("NFKC", str(value)).casefold().split())


def load_boundaries(root, filename, code_column, name_column, expected):
    path = root / "data/raw" / filename
    frame = gpd.read_file(f"zip://{path}")
    if frame.crs is None or not {code_column, name_column}.issubset(frame.columns):
        raise ValueError(f"CRS o colonne mancanti: {filename}")
    frame = frame.rename(columns={code_column: "area_id", name_column: "name"})
    frame["area_id"] = frame.area_id.map(area_code)
    frame["name"] = frame.name.str.strip()
    if len(frame) != expected or frame.area_id.duplicated().any():
        raise ValueError(f"Numero aree o codici duplicati: {filename}")
    if frame.geometry.is_empty.any() or frame.geometry.isna().any() or not frame.is_valid.all():
        raise ValueError(f"Geometrie vuote o non valide: {filename}")
    if not frame.geometry.geom_type.isin(["Polygon", "MultiPolygon"]).all():
        raise ValueError(f"Geometrie non poligonali: {filename}")
    return frame[["area_id", "name", "geometry"]]


def match_neighborhoods(zones, neighborhoods):
    if zones.crs is None or neighborhoods.crs is None:
        raise ValueError("CRS richiesto per il raccordo geografico.")
    if zones.area_id.duplicated().any() or neighborhoods.area_id.duplicated().any():
        raise ValueError("Codici geografici duplicati.")
    zones = zones.to_crs(METRIC_CRS)
    neighborhoods = neighborhoods.to_crs(METRIC_CRS)
    matches = []
    for zone in zones.itertuples():
        if zone.geometry.is_empty or not zone.geometry.is_valid or zone.geometry.area <= 0:
            raise ValueError(f"Zona non valida: {zone.area_id}")
        overlaps = sorted(
            [(zone.geometry.intersection(q.geometry).area, q.area_id)
             for q in neighborhoods.itertuples()],
            key=lambda item: (-item[0], int(item[1])),
        )
        area, neighborhood_id = overlaps[0]
        if area <= 0:
            raise ValueError(f"Nessun quartiere interseca la zona {zone.area_id}")
        share = min(1.0, area / zone.geometry.area)
        matches.append({
            "zone_id": zone.area_id, "neighborhood_id": neighborhood_id,
            "overlap_share": share, "approximate": share < 1 - 1e-9,
            "crosses_boundary": share < 0.99999,
            "tie": len(overlaps) > 1 and math.isclose(area, overlaps[1][0], abs_tol=1e-6, rel_tol=0),
            "method": METHOD,
        })
    return sorted(matches, key=lambda row: row["zone_id"])


def read_social(root, zones):
    # Read directly from the immutable archive instead of trusting an extracted copy.
    with zipfile.ZipFile(root / "data/raw/idise_piemonte_2023.zip") as archive:
        workbook = archive.read("001272_Torino/001272_Torino.xlsx")
        record = archive.read("001272_Torino/Tracciato_record-dati-disagio_2023.xlsx")
    schema = pd.read_excel(io.BytesIO(record), sheet_name=0, header=None)
    labels = dict(zip(schema[0], schema[1]))
    if labels.get("COD_ASC") != "Codice ASC" or labels.get("IDISE") != "Indice composito AMPI+":
        raise ValueError("Tracciato record IDISE non riconosciuto.")
    frame = pd.read_excel(io.BytesIO(workbook), sheet_name="ASC_2023", dtype={"PRO_COM": str, "COD_ASC": str})
    frame = frame[frame.PRO_COM == "001272"]
    by_code = {}
    excluded = []
    for row in frame.itertuples():
        if pd.isna(row.COD_ASC):
            excluded.append("municipality-total")
            continue
        if str(row.ASC).startswith("Sezione Fittizia"):
            excluded.append(str(row.ASC))
            continue
        code = str(row.COD_ASC)
        if code in by_code:
            raise ValueError(f"COD_ASC duplicato: {code}")
        by_code[code] = row
    result = []
    for zone in zones.itertuples():
        # Dataset-specific crosswalk, checked against the full published ASC label.
        number = {"09bis": 93, "17bis": 94}.get(zone.area_id)
        if number is None:
            number = int(zone.area_id)
        asc = f"1272{number:03d}"
        row = by_code.pop(asc, None)
        if row is None or label(row.ASC) != label(zone.name):
            raise ValueError(f"Raccordo ASC/zona non verificato: {asc}, {zone.area_id}")
        value = None if pd.isna(row.IDISE) else float(row.IDISE)
        if value is not None and (not math.isfinite(value) or value <= 0):
            raise ValueError(f"IDISE non valido: {asc}")
        result.append({"zone_id": zone.area_id, "asc_code": asc, "idise": value,
                       "missing_reason": "not-published" if value is None else None, "year": 2023})
    if by_code:
        raise ValueError(f"ASC non raccordate: {sorted(by_code)}")
    return result, excluded


def import_geography(root=ROOT, db_path=None):
    db_path = db_path or root / "data/processed/planner.sqlite"
    neighborhoods = load_boundaries(root, "ex_quartieri.zip", "IDQUART", "DESCR", 23)
    zones = load_boundaries(root, "zone_statistiche_geo.zip", "ZONASTAT", "DENOM", 94)
    matches = match_neighborhoods(zones, neighborhoods)
    social, excluded = read_social(root, zones)
    demography = import_demography(root, db_path)
    manifest = json.loads((root / "data/download_manifest.json").read_text())
    sources = {row["file"]: row for row in manifest["datasets"]}
    source_hashes = {}
    for filename in ["ex_quartieri.zip", "zone_statistiche_geo.zip", "idise_piemonte_2023.zip"]:
        digest = hashlib.sha256((root / "data/raw" / filename).read_bytes()).hexdigest()
        if sources[filename].get("sha256") and sources[filename]["sha256"] != digest:
            raise ValueError(f"Checksum diverso: {filename}")
        source_hashes[filename] = digest
    with sqlite3.connect(db_path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS geographic_areas (
                kind TEXT NOT NULL, area_id TEXT NOT NULL, name TEXT NOT NULL,
                geojson TEXT NOT NULL, source_sha256 TEXT NOT NULL REFERENCES dataset_sources(sha256),
                PRIMARY KEY(kind, area_id)
            );
            CREATE TABLE IF NOT EXISTS zone_neighborhoods (
                zone_id TEXT PRIMARY KEY, neighborhood_id TEXT NOT NULL,
                overlap_share REAL NOT NULL, approximate INTEGER NOT NULL,
                crosses_boundary INTEGER NOT NULL, tie INTEGER NOT NULL, method TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS social_indicators (
                zone_id TEXT NOT NULL, asc_code TEXT NOT NULL, idise REAL,
                missing_reason TEXT, year INTEGER NOT NULL,
                source_sha256 TEXT NOT NULL REFERENCES dataset_sources(sha256),
                PRIMARY KEY(zone_id, year)
            );
        """)
        for filename, digest in source_hashes.items():
            db.execute("INSERT OR IGNORE INTO dataset_sources VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (digest, filename, sources[filename]["url"], manifest.get("attempted_at"),
                        2023 if filename.startswith("idise") else 0, PARSER_VERSION,
                        "requires-source-license-verification"))
        for kind, frame, filename in [("neighborhood", neighborhoods, "ex_quartieri.zip"),
                                      ("zone", zones, "zone_statistiche_geo.zip")]:
            expected = {r[0] for r in db.execute("SELECT area_id FROM demographics WHERE kind=? AND geographic=1", (kind,))}
            if expected != set(frame.area_id):
                raise ValueError(f"Geometrie e demografia non coincidono: {kind}")
            for row in frame.to_crs("EPSG:4326").itertuples():
                db.execute("INSERT OR REPLACE INTO geographic_areas VALUES (?, ?, ?, ?, ?)",
                           (kind, row.area_id, row.name, json.dumps(row.geometry.__geo_interface__), source_hashes[filename]))
        for row in matches:
            db.execute("INSERT OR REPLACE INTO zone_neighborhoods VALUES (?, ?, ?, ?, ?, ?, ?)",
                       tuple(row[key] for key in ["zone_id", "neighborhood_id", "overlap_share", "approximate", "crosses_boundary", "tie", "method"]))
        for row in social:
            db.execute("INSERT OR REPLACE INTO social_indicators VALUES (?, ?, ?, ?, ?, ?)",
                       (row["zone_id"], row["asc_code"], row["idise"], row["missing_reason"], row["year"], source_hashes["idise_piemonte_2023.zip"]))
    return {"parser_version": PARSER_VERSION, "public_unit": "neighborhood",
            "method": METHOD, "neighborhoods": len(neighborhoods), "zones": len(zones),
            "social_available": sum(row["idise"] is not None for row in social),
            "social_excluded_rows": excluded, "matches": matches,
            "demography": demography,
            "limitations": ["Attribuzione delle zone al quartiere con maggiore intersezione, autorizzata per il prototipo.",
                            "IDISE rimane un indicatore di sottozona: nessuna media o redistribuzione per superficie."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=str, default=str(ROOT / "data/processed/planner.sqlite"))
    args = parser.parse_args()
    report = import_geography(db_path=args.database)
    from pathlib import Path
    Path(args.database).with_suffix(".geography.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Importati {report['neighborhoods']} quartieri, {report['zones']} zone, {report['social_available']} IDISE pubblicati.")
