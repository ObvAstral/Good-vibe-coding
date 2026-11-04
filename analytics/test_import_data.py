import csv
import sqlite3
import tempfile
import unittest
from pathlib import Path

from import_data import ROOT, area_code, import_demography, read_population


class ImportTests(unittest.TestCase):
    def test_codes_preserve_bis(self):
        self.assertEqual(area_code("009bis"), "09bis")
        self.assertEqual(area_code("17bis"), "17bis")
        self.assertEqual(area_code("001"), "1")
        with self.assertRaises(ValueError):
            area_code("1.0")

    def test_real_data_is_idempotent_and_virtual_is_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "planner.sqlite"
            first = import_demography(db_path=path)
            self.assertEqual(first, import_demography(db_path=path))
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM dataset_sources").fetchone()[0], 2)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM demographics").fetchone()[0], 119)
                for kind, n in [("neighborhood", 23), ("zone", 94)]:
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM demographics WHERE kind=? AND geographic=1", (kind,)).fetchone()[0], n)
                    self.assertEqual(db.execute("SELECT SUM(population) FROM demographics WHERE kind=?", (kind,)).fetchone()[0], 863249)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM demographics WHERE area_id IN ('09bis','17bis')").fetchone()[0], 2)

    def test_duplicate_codes_and_missing_values_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.csv"
            header = 'num_quartiere;desc_quartiere;femmine;maschi\n'
            for data in ['1;Centro;1;2\n01;Centro;1;2\n', '1;Centro;;2\n', '1;Centro;-1;2\n']:
                path.write_text(header + data)
                with self.assertRaises(ValueError):
                    read_population(path, 'neighborhood')


if __name__ == '__main__':
    unittest.main()
