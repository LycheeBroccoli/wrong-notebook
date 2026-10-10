#!/usr/bin/env python3
"""Reject publication of local deploy archives that contain private history."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], stderr=subprocess.DEVNULL).decode().strip())
PRIVATE_ROOT = 'b570296c3059231c3ca4a7ba65dbfb125c43b5e4'


def git(*args):
    return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True)


def allowed(reference, commit):
    if reference.startswith('refs/heads/archive/'):
        return False
    if commit == '0' * 40:
        return True
    if git('cat-file', '-e', PRIVATE_ROOT + '^{commit}').returncode == 0:
        result = git('merge-base', '--is-ancestor', PRIVATE_ROOT, commit)
        if result.returncode == 0:
            return False
        if result.returncode != 1:
            raise RuntimeError('Cannot verify outgoing history')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', help='Validate one local commit without pushing')
    # Git passes the remote name and URL to the pre-push hook.
    parser.add_argument('remote', nargs='?')
    parser.add_argument('url', nargs='?')
    args = parser.parse_args()
    if args.check:
        result = git('rev-parse', '--verify', args.check + '^{commit}')
        if result.returncode:
            raise RuntimeError('Unknown local commit')
        requests = [('manual-check', result.stdout.decode().strip())]
    else:
        requests = []
        for line in sys.stdin:
            fields = line.split()
            if len(fields) != 4:
                raise RuntimeError('Invalid pre-push input')
            requests.append((fields[0], fields[1]))
    for reference, commit in requests:
        if not allowed(reference, commit):
            print('Push blocked: private deploy archive ancestry must remain local. Use the audited integration/main history.', file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Push blocked: history validation failed.', file=sys.stderr)
        sys.exit(1)
