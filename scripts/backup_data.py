#!/usr/bin/env python3
"""Private SQLite/code snapshots. Never upload the plaintext output to GitHub."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def readonly(path):
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError('Source database is missing or empty')
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)


def database_summary(connection):
    integrity = [r[0] for r in connection.execute('PRAGMA integrity_check')]
    if integrity != ['ok']:
        raise ValueError('Database integrity check failed')
    tables = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        columns = [r[1] for r in connection.execute('PRAGMA table_info(' + quote(name) + ')')]
        query = 'SELECT * FROM ' + quote(name) + ' ORDER BY ' + ','.join(map(quote, columns))
        digest = hashlib.sha256()
        count = 0
        for row in connection.execute(query):
            values = [{'blob': v.hex()} if isinstance(v, bytes) else v for v in row]
            digest.update(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode('utf-8') + b'\n')
            count += 1
        tables[name] = {'rows': count, 'sha256': digest.hexdigest()}
    return {'integrity': integrity, 'foreign_key_violations': len(list(connection.execute('PRAGMA foreign_key_check'))), 'tables': tables}


def resolve_database(repo):
    # Match Prisma's file: paths relative to schema.prisma, not the shell cwd.
    import re
    value = os.environ.get('DATABASE_URL')
    if not value:
        env = repo / '.env'
        if env.is_file():
            match = re.search(r'^\s*DATABASE_URL\s*=\s*(.+?)\s*$', env.read_text(encoding='utf-8-sig'), re.M)
            if match:
                value = match[1].strip().strip('"\'')
    if not value or not value.startswith('file:'):
        raise ValueError('Explicit local SQLite DATABASE_URL is required')
    raw = value[5:]
    if '?' in raw:
        raise ValueError('Database URL options need explicit review')
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (repo / 'prisma' / path).resolve()


def copy_file(source, destination):
    if source.is_symlink():
        raise ValueError('Refusing to archive a symlink')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def repository_snapshot(repo, destination, database):
    destination.mkdir(parents=True)
    git(repo, 'bundle', 'create', str(destination / 'history.bundle'), '--all')
    paths = set(p for p in git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0') if p)
    # Include ignored private runtime assets, mirror files and historical DB copies.
    for pattern in ('.env*', 'config/**/*', 'certs/**/*', 'prisma/*.db*', 'public/ggb-mirror/**/*'):
        paths.update(str(p.relative_to(repo)).replace('\\', '/') for p in repo.glob(pattern) if p.is_file())
    for relative in sorted(paths):
        source = repo / relative
        if not source.is_file() or source.resolve() == database:
            continue
        if relative.endswith(('-wal', '-shm', '-journal')):
            continue
        copy_file(source, destination / 'files' / relative)
    (destination / 'git-status.txt').write_bytes(git(repo, 'status', '--porcelain=v1'))
    (destination / 'unstaged.patch').write_bytes(git(repo, 'diff', '--binary'))
    (destination / 'staged.patch').write_bytes(git(repo, 'diff', '--cached', '--binary'))
    return {'source': str(repo), 'head': git(repo, 'rev-parse', 'HEAD').decode().strip()}


def backup(args):
    repo = args.repo.resolve()
    database = args.database.resolve() if args.database else resolve_database(repo)
    backup_root = args.backup_root.resolve()
    if backup_root == repo or repo in backup_root.parents:
        raise ValueError('Backup root must be outside the source repository')
    directory = backup_root / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    directory.mkdir(parents=True, exist_ok=False)
    try:
        with closing(readonly(database)) as source:
            source.execute('BEGIN')
            before = database_summary(source)
            with closing(sqlite3.connect(directory / 'database.sqlite')) as target:
                source.backup(target)
                after = database_summary(target)
            if before != after:
                raise ValueError('Snapshot differs from the source transaction')
            references = source.execute('SELECT originalImageUrl FROM ErrorItem').fetchall()
            local_count = 0
            for (reference,) in references:
                if not reference or reference.startswith(('data:', 'http:', 'https:')):
                    continue
                relative = Path(reference.lstrip('/'))
                candidates = [repo / 'public' / relative, repo / relative]
                match = next((p.resolve() for p in candidates if p.is_file()), None)
                if match is None or repo not in match.parents:
                    raise ValueError('Unresolved or external local image reference; backup is incomplete')
                copy_file(match, directory / 'referenced-files' / match.relative_to(repo))
                local_count += 1
        repositories = {'deploy': repository_snapshot(repo, directory / 'repositories' / 'deploy', database)}
        if args.lb_repo:
            lb = args.lb_repo.resolve()
            repositories['lb'] = repository_snapshot(lb, directory / 'repositories' / 'lb', database)
        files = {str(p.relative_to(directory)).replace('\\', '/'): sha(p) for p in directory.rglob('*') if p.is_file()}
        manifest = {'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'database_source': str(database), 'database': before, 'repositories': repositories, 'images': {'embedded': sum(bool(r[0]) and r[0].startswith('data:') for r in references), 'empty': sum(not r[0] for r in references), 'local': local_count}, 'files': files, 'offsite_verified': False}
        (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        verify_directory(directory)
        print(json.dumps({'backup': str(directory), 'verified': True, 'tables': {k: v['rows'] for k, v in before['tables'].items()}, 'images': manifest['images']}, ensure_ascii=False))
    except Exception:
        (directory / 'INCOMPLETE.txt').write_text('Backup failed. Do not upload or treat as verified.', encoding='utf-8')
        raise


def verify_directory(directory):
    if (directory / 'INCOMPLETE.txt').exists():
        raise ValueError('Snapshot was marked incomplete')
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    for relative, expected in manifest['files'].items():
        path = (directory / relative).resolve()
        if directory.resolve() not in path.parents or not path.is_file() or sha(path) != expected:
            raise ValueError('Snapshot file checksum mismatch')
    with closing(readonly(directory / 'database.sqlite')) as connection:
        if database_summary(connection) != manifest['database']:
            raise ValueError('Restored logical data does not match manifest')
    for name in manifest['repositories']:
        result = subprocess.run(['git', 'bundle', 'verify', str(directory / 'repositories' / name / 'history.bundle')], cwd=ROOT, capture_output=True)
        if result.returncode:
            raise ValueError('Git bundle verification failed')
    return manifest


def restore(args):
    snapshot = args.snapshot.resolve()
    manifest = verify_directory(snapshot)
    target = args.target.resolve()
    forbidden = [Path(v['source']).resolve() for v in manifest['repositories'].values()]
    forbidden.append(Path(manifest['database_source']).resolve().parent)
    if target.exists() or any(target == p or p in target.parents or target in p.parents for p in forbidden):
        raise ValueError('Restore target must be a new isolated directory outside original repositories')
    shutil.copytree(snapshot, target)
    verify_directory(target)
    print(json.dumps({'restored': str(target), 'verified': True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    make = subs.add_parser('backup')
    make.add_argument('--repo', type=Path, default=ROOT)
    make.add_argument('--database', type=Path)
    make.add_argument('--lb-repo', type=Path)
    make.add_argument('--backup-root', type=Path, default=Path('E:/wrong-notebook-backups'))
    check = subs.add_parser('verify')
    check.add_argument('snapshot', type=Path)
    restore_parser = subs.add_parser('restore')
    restore_parser.add_argument('snapshot', type=Path)
    restore_parser.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'backup':
        backup(args)
    elif args.command == 'verify':
        verify_directory(args.snapshot.resolve())
        print('Snapshot verification passed')
    else:
        restore(args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Backup operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
