import sqlite3
import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

from geography import import_geography, match_neighborhoods


def areas(ids, polygons):
    return gpd.GeoDataFrame({"area_id": ids, "name": ids}, geometry=polygons, crs="EPSG:32632")


class GeographyTests(unittest.TestCase):
    def test_largest_overlap_keeps_crossing_zones(self):
        zones = areas(["1"], [box(0, 0, 10, 10)])
        neighborhoods = areas(["2", "1"], [box(6, 0, 10, 10), box(0, 0, 6, 10)])
        match = match_neighborhoods(zones, neighborhoods)[0]
        self.assertEqual(match["neighborhood_id"], "1")
        self.assertAlmostEqual(match["overlap_share"], 0.6)
        self.assertTrue(match["approximate"])
        self.assertTrue(match["crosses_boundary"])

    def test_ties_are_stable_and_non_intersecting_zones_rejected(self):
        zone = areas(["1"], [box(0, 0, 10, 10)])
        neighborhoods = areas(["2", "1"], [box(5, 0, 10, 10), box(0, 0, 5, 10)])
        a = match_neighborhoods(zone, neighborhoods)[0]
        b = match_neighborhoods(zone, neighborhoods.iloc[::-1])[0]
        self.assertEqual(a, b)
        self.assertTrue(a["tie"])
        self.assertEqual(a["neighborhood_id"], "1")
        with self.assertRaises(ValueError):
            match_neighborhoods(areas(["3"], [box(20, 20, 30, 30)]), neighborhoods)

    def test_requires_crs_and_unique_codes(self):
        frame = areas(["1"], [box(0, 0, 1, 1)])
        with self.assertRaises(ValueError):
            match_neighborhoods(frame.set_crs(None, allow_override=True), frame)
        with self.assertRaises(ValueError):
            match_neighborhoods(areas(["1", "1"], [box(0, 0, 1, 1)] * 2), frame)

    def test_real_data_neighborhoods_and_social_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "planner.sqlite"
            first = import_geography(db_path=path)
            self.assertEqual(first, import_geography(db_path=path))
            self.assertEqual((first["neighborhoods"], first["zones"], first["social_available"]), (23, 94, 89))
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM zone_neighborhoods").fetchone()[0], 94)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM social_indicators WHERE idise IS NULL").fetchone()[0], 5)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM social_indicators WHERE idise=0").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM social_indicators WHERE asc_code='1272065'").fetchone()[0], 1)
                for zone, neighborhood, name in [("26", "3", "Crocetta"), ("51", "13", "Pozzo Strada")]:
                    self.assertEqual(db.execute("SELECT neighborhood_id FROM zone_neighborhoods WHERE zone_id=?", (zone,)).fetchone()[0], neighborhood)
                    self.assertEqual(db.execute("SELECT name FROM geographic_areas WHERE kind='neighborhood' AND area_id=?", (neighborhood,)).fetchone()[0], name)
                self.assertEqual(db.execute("SELECT asc_code FROM social_indicators WHERE zone_id='09bis'").fetchone()[0], '1272093')
                self.assertEqual(db.execute("SELECT asc_code FROM social_indicators WHERE zone_id='17bis'").fetchone()[0], '1272094')
                self.assertEqual(db.execute("SELECT COUNT(*) FROM geographic_areas WHERE area_id='0'").fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
