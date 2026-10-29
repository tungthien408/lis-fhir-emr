"""Optional OFFLINE JSON Schema check; not a full HL7 or clinical validator.

Provide the official R4 fhir.schema.json locally. fastjsonschema is a separate
test tool, not a backend dependency. This script makes no network/DB requests.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("schema", type=Path, help="Local official HL7 R4 fhir.schema.json")
    parser.add_argument("--resources", type=Path, default=(
        Path(__file__).resolve().parent.parent
        / "backend/tests/middleware/fixtures/observation-r4-golden.json"
    ), help="One Observation object or an array of mapper output objects")
    args = parser.parse_args()
    try:
        import fastjsonschema
    except ImportError:
        parser.error("This optional check needs the separate fastjsonschema tool; normal npm tests do not")

    schema_bytes = args.schema.read_bytes()
    official = json.loads(schema_bytes)
    # Retain ALL official definitions unchanged, select only the Observation root.
    schema = {"$schema": official["$schema"], "$ref": "#/definitions/Observation",
              "definitions": official["definitions"]}
    validate = fastjsonschema.compile(schema, use_default=False)
    resources = json.loads(args.resources.read_text(encoding="utf-8"))
    if not isinstance(resources, list):
        resources = [resources]
    if not resources:
        parser.error("Provide at least one Observation")
    for resource in resources:
        validate(resource)
    print(json.dumps({
        "passed": len(resources), "root": "#/definitions/Observation",
        "schema_sha256": hashlib.sha256(schema_bytes).hexdigest(),
        "scope": "JSON Schema structure only; not FHIRPath, terminology or clinical correctness",
    }, indent=2))


if __name__ == "__main__":
    main()
