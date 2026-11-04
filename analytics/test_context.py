import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import shape

from geography import import_geography
from import_context import import_context
from import_points import import_points


class ContextTests(unittest.TestCase):
    def test_partners_idempotent_and_separate_from_affiliations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'planner.sqlite'
            import_geography(db_path=path)
            a = import_context(path)
            self.assertEqual(a, import_context(path))
            self.assertEqual(a['potential_food_partners'], 5849)
            self.assertGreater(a['prose_chunks'], 500)
            self.assertFalse(a['table_values_imported'])
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM potential_partners').fetchone()[0], 5849)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM potential_partners WHERE category NOT IN ('ALIMENTARI','MISTA')").fetchone()[0], 0)

    def test_positions_versioned_and_moves_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'planner.sqlite'
            import_geography(db_path=path)
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE point_locations(deployment TEXT,point_id TEXT,latitude REAL,longitude REAL,neighborhood_id TEXT,zone_id TEXT,PRIMARY KEY(deployment,point_id)); CREATE TABLE planner_state(key TEXT PRIMARY KEY,value TEXT);')
                polygon = shape(json.loads(db.execute("SELECT geojson FROM geographic_areas WHERE kind='neighborhood' AND area_id='3'").fetchone()[0]))
                p = polygon.representative_point()
            registry = {'chainId': 31337, 'contractAddress': '0x' + '1' * 40, 'deploymentBlockHash': '0x' + '2' * 64,
                        'points': [{'pointId': '1', 'latitude': p.y, 'longitude': p.x}]}
            self.assertEqual(import_points(path, registry), 1)
            self.assertEqual(import_points(path, registry), 1)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT neighborhood_id FROM point_locations').fetchone()[0], '3')
            registry['points'][0]['latitude'] += .01
            with self.assertRaises(ValueError):
                import_points(path, registry)
            registry['points'][0]['latitude'] = float('nan')
            with self.assertRaises(ValueError):
                import_points(path, registry)


if __name__ == '__main__':
    unittest.main()
