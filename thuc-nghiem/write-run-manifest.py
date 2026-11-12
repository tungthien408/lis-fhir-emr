#!/usr/bin/env python3
"""Record source/configuration fingerprints; never serialize credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--oracle", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent


def git(*command):
    return subprocess.check_output(["git", "-C", str(root), *command])


def sha(data):
    return hashlib.sha256(data).hexdigest()


scope = ["backend/src", "backend/tests", "backend/scripts", "database", "frontend/apps/*/src",
         "frontend/apps/*/tests/*.mjs", "frontend/apps/*/tests/*.test.mjs", "thuc-nghiem/*.sh", "thuc-nghiem/*.py", "compose.yaml"]
files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *scope).decode().split("\0")
fingerprints = {}
for name in sorted(set(files)):
    path = root / name
    if name and path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
        fingerprints[name] = sha(path.read_bytes())
oracle_bytes = args.oracle.read_bytes()
oracle = json.loads(oracle_bytes)
rules = json.loads((args.oracle.parent / "rules.json").read_text())
compose = json.loads(subprocess.check_output(["docker", "compose", "-p", "lisexp", "--project-directory", str(root),
                    "-f", str(root / "compose.yaml"), "--profile", "dispatcher", "--profile", "worker", "config", "--format", "json"], cwd=root))
configuration = {}
for service in ("lis-dispatcher", "middleware-worker"):
    environment = compose["services"][service]["environment"]
    configuration[service] = {key: value for key, value in environment.items()
                              if key.endswith(("_HTTP_TIMEOUT_MS", "_LEASE_MS", "_POLL_MS", "_MAX_ATTEMPTS", "_RETRY_DELAYS_MS"))}
result = {
    "run_tag": os.environ["RUN_TAG"], "base_commit": git("rev-parse", "HEAD").decode().strip(),
    "product_diff_sha256": sha(git("diff", "HEAD", "--binary", "--", *scope)),
    "source_files": fingerprints, "source_tree_sha256": sha(json.dumps(fingerprints, sort_keys=True).encode()),
    "reference": {"version": os.environ["EXPERIMENT_REFERENCE_VERSION"], "manifest_sha256": sha(oracle_bytes),
                  "rules_version": rules["version"], "namespaces": {key: rules[key] for key in ("result_system", "patient_system", "test_system")}},
    "catalog_version": "mimic-iv-demo-2.2-v1", "configuration": configuration,
    "topology": {"lis_dispatcher_processes": 1, "middleware_worker_processes": 1},
}
args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
