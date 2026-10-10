import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
import gc
import time

spec = importlib.util.spec_from_file_location('backup_data', Path(__file__).with_name('backup_data.py'))
backup_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_data)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.cleanup_temp)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        (self.repo / 'prisma').mkdir()
        (self.repo / '.env').write_text('DATABASE_URL="file:./dev.db"', encoding='utf-8')
        (self.repo / '.gitignore').write_text('.env\n*.db\n', encoding='utf-8')
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        subprocess.run(['git', '-C', str(self.repo), 'add', '.gitignore'], check=True)
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=Backup Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
        self.db = self.repo / 'prisma/dev.db'
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute('CREATE TABLE ErrorItem(id TEXT PRIMARY KEY, originalImageUrl TEXT, analysis TEXT)')
            connection.execute('INSERT INTO ErrorItem VALUES (?, ?, ?)', ('example', 'data:image/png;base64,AA==', 'synthetic solution'))
            connection.commit()
        (self.repo / 'increment.py').write_text('print("uncommitted")', encoding='utf-8')

    def cleanup_temp(self):
        # Windows file scanners can briefly hold newly created Git files open.
        for attempt in range(10):
            gc.collect()
            try:
                self.temp.cleanup()
                return
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.2)

    def make_snapshot(self):
        from argparse import Namespace
        backup_data.backup(Namespace(repo=self.repo, database=self.db, backup_root=self.base / 'backups', lb_repo=None))
        return next((self.base / 'backups').iterdir())

    def test_snapshot_restore_and_tampering(self):
        snapshot = self.make_snapshot()
        manifest = backup_data.verify_directory(snapshot)
        self.assertEqual(manifest['database']['tables']['ErrorItem']['rows'], 1)
        self.assertEqual((snapshot / 'repositories/deploy/files/increment.py').read_bytes(), (self.repo / 'increment.py').read_bytes())
        from argparse import Namespace
        restored = self.base / 'restored'
        backup_data.restore(Namespace(snapshot=snapshot, target=restored))
        with self.assertRaises(ValueError):
            backup_data.restore(Namespace(snapshot=snapshot, target=self.repo / 'restore'))
        (snapshot / 'repositories/deploy/files/increment.py').write_text('tampered')
        with self.assertRaises(ValueError):
            backup_data.verify_directory(snapshot)

    def test_missing_database_is_not_created(self):
        missing = self.repo / 'prisma/missing.db'
        with self.assertRaises(ValueError):
            backup_data.readonly(missing)
        self.assertFalse(missing.exists())

    def test_wal_commits_are_in_snapshot(self):
        connection = sqlite3.connect(self.db)
        self.addCleanup(connection.close)
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('INSERT INTO ErrorItem VALUES (?, ?, ?)', ('wal', '', 'committed WAL solution'))
        connection.commit()
        snapshot = self.make_snapshot()
        self.assertEqual(backup_data.verify_directory(snapshot)['database']['tables']['ErrorItem']['rows'], 2)


if __name__ == '__main__':
    unittest.main()
