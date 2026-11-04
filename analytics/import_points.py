"""Importa le posizioni verificate dal collega, senza generare transazioni."""
import argparse
import json
import math
import sqlite3

from shapely.geometry import Point, shape


def import_points(db_path, registry):
    required = {'chainId', 'contractAddress', 'deploymentBlockHash', 'points'}
    if set(registry) != required or registry['chainId'] != 31337:
        raise ValueError('Registro non valido: servono chainId, contractAddress, deploymentBlockHash e points.')
    import re
    if not re.fullmatch(r'0x[0-9a-fA-F]{40}', registry['contractAddress']) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', registry['deploymentBlockHash']):
        raise ValueError('Indirizzo o hash non valido.')
    deployment = f"31337/{registry['contractAddress'].lower()}/{registry['deploymentBlockHash'].lower()}"
    with sqlite3.connect(db_path) as db:
        boundaries = {kind: [(r[0], shape(json.loads(r[1]))) for r in db.execute('SELECT area_id,geojson FROM geographic_areas WHERE kind=? ORDER BY area_id', (kind,))] for kind in ['neighborhood', 'zone']}
        rows, seen = [], set()
        for row in registry['points']:
            if set(row) != {'pointId', 'latitude', 'longitude'} or not re.fullmatch(r'[1-9][0-9]*', str(row['pointId'])) or str(row['pointId']) in seen:
                raise ValueError('Punto duplicato o non valido.')
            seen.add(str(row['pointId']))
            lat, lon = float(row['latitude']), float(row['longitude'])
            if not math.isfinite(lat + lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError('Coordinate non valide.')
            p = Point(lon, lat)
            matches = {kind: [code for code, polygon in areas if polygon.covers(p)] for kind, areas in boundaries.items()}
            # Boundary ambiguity is retained as missing rather than silently picking a location.
            rows.append((deployment, str(row['pointId']), lat, lon,
                         matches['neighborhood'][0] if len(matches['neighborhood']) == 1 else None,
                         matches['zone'][0] if len(matches['zone']) == 1 else None))
        for row in rows:
            old = db.execute('SELECT latitude,longitude FROM point_locations WHERE deployment=? AND point_id=?', row[:2]).fetchone()
            if old and old != row[2:4]:
                raise ValueError('Un punto spostato deve avere un nuovo pointId.')
        db.executemany('INSERT OR REPLACE INTO point_locations VALUES (?,?,?,?,?,?)', rows)
        db.execute("INSERT OR REPLACE INTO planner_state VALUES ('ragDirty','true')")
    return len(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('registry')
    parser.add_argument('--database', default='data/processed/planner.sqlite')
    args = parser.parse_args()
    print('Posizioni importate:', import_points(args.database, json.load(open(args.registry))))
