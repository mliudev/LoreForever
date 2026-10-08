"""Verify the installed candidate has every ZIP member, byte for byte."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

archive, addons = Path(sys.argv[1]), Path(sys.argv[2])
failures = []
checked = 0
expected = set()
with zipfile.ZipFile(archive) as package:
    for member in package.infolist():
        if member.is_dir():
            continue
        target = addons / member.filename
        expected.add(member.filename)
        if not target.is_file():
            failures.append(f"missing {member.filename}")
            continue
        want = hashlib.sha256(package.read(member)).digest()
        got = hashlib.sha256(target.read_bytes()).digest()
        if want != got:
            failures.append(f"changed {member.filename}")
        checked += 1
for root in {name.split('/')[0] for name in expected}:
    for actual in (addons / root).rglob('*'):
        if actual.is_file() and actual.relative_to(addons).as_posix() not in expected:
            failures.append(f"unexpected {actual.relative_to(addons).as_posix()}")
print(json.dumps({'checked': checked, 'passed': not failures, 'failures': failures}, indent=2))
sys.exit(bool(failures))
