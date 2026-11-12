#!/usr/bin/env python3
"""Derive only namespace columns from v2, then independently crosscheck raw MIMIC/seed.

No product module or product output is read. The v2 freeze and evidence remain intact.
"""
import argparse
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import sys

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
V2 = HERE.parent / "reference/spp65-v2"
SYSTEMS = {
    "https://example.org/lis/result": "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62",
    "https://example.org/lis/patient": "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4",
    "https://example.org/lis/test-code": "urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02",
}
COLUMNS = {
    "MR01_identifier_system": "https://example.org/lis/result",
    "MR02_subject_system": "https://example.org/lis/patient",
    "MR03_code_system": "https://example.org/lis/test-code",
    "expected_emr_external_system": "https://example.org/lis/result",
    "expected_emr_analyte_system": "https://example.org/lis/test-code",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def freeze(output):
    spec = importlib.util.spec_from_file_location("independent_v2_freeze", HERE / "freeze-reference.py")
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    manifest_bytes = (V2 / "manifest.json").read_bytes()
    manifest_sha = digest(manifest_bytes)
    legacy.require(manifest_sha == (V2 / "manifest.sha256").read_text().strip(), "V2 manifest checksum mismatch")
    manifest = json.loads(manifest_bytes)
    for name, checksum in manifest["files"].items():
        legacy.require(digest((V2 / name).read_bytes()) == checksum, "V2 file checksum mismatch: " + name)
    seed_path = ROOT / "database/seed/01_reference_data.sql"
    seed = seed_path.read_text()
    reversed_seed = seed
    for old, new in SYSTEMS.items():
        reversed_seed = reversed_seed.replace(new, old)
    legacy.require(digest(reversed_seed.encode()) == legacy.PINNED["database/seed/01_reference_data.sql"],
                   "Reference seed changes must be namespace-only")
    upstream = (V2 / "upstream-answers.csv").read_bytes()
    reader = csv.DictReader(io.StringIO(upstream.decode("utf-8-sig")))
    rows = list(reader)
    legacy.require(len(rows) == 1000, "Expected 1000 v2 rows")
    for row in rows:
        for column, old in COLUMNS.items():
            legacy.require(row[column] == old, "Unexpected v2 namespace: " + column)
            row[column] = SYSTEMS[old]
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=reader.fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    transformed = buffer.getvalue().encode()
    legacy.PINNED = {**legacy.PINNED, "database/seed/01_reference_data.sql": digest(seed_path.read_bytes())}
    legacy.RULES = {**legacy.RULES, "version": "spp82-independent-mr01-mr09-v2",
                    "result_system": SYSTEMS[COLUMNS["MR01_identifier_system"]],
                    "patient_system": SYSTEMS[COLUMNS["MR02_subject_system"]],
                    "test_system": SYSTEMS[COLUMNS["MR03_code_system"]]}
    with tempfile.TemporaryDirectory(prefix="independent-reference-v3-") as temp:
        csv_path = Path(temp) / "DAP_AN_DOC_LAP_1000_NAMESPACE_V3.csv"
        csv_path.write_bytes(transformed)
        with contextlib.redirect_stdout(io.StringIO()):
            legacy.freeze(csv_path, digest(transformed), output)
    path = output / "manifest.json"
    result = json.loads(path.read_text())
    result["provenance"].update({
        "preparation_script_sha256": digest(Path(__file__).read_bytes()),
        "crosscheck_script_sha256": digest((HERE / "freeze-reference.py").read_bytes()),
        "derived_from": {"reference": "spp65-v2", "manifest_sha256": manifest_sha, "upstream_sha256": digest(upstream)},
        "namespace_migration": {column: {"from": old, "to": SYSTEMS[old]} for column, old in COLUMNS.items()},
    })
    result["provenance"]["limitations"].append("V3 changes only five namespace columns; clinical answers and source identities are inherited from v2 and rechecked against raw CSV.")
    path.write_text(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2) + "\n")
    checksum = digest(path.read_bytes())
    (output / "manifest.sha256").write_text(checksum + "\n")
    print(json.dumps({"population": 1000, "patient_links": 100, "manifest_sha256": checksum}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    freeze(parser.parse_args().output)
