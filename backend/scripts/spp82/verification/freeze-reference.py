#!/usr/bin/env python3
"""Offline reference preparation. Never imports Mapper, reads DB, or changes upstream data."""
import argparse
import csv
from decimal import Decimal
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[4]
PINNED = {
    'database/seed/01_reference_data.sql': 'b66613cf2e1ed1f8d46ce6f0a0efc2efa976532e4e487bf6058ec43e835023e5',
    'database/seed/02_lis_results.sql': '28b21b4e19f1df9b79d8ee10944e33e1f1fe20c0045abfd5b5d3fbcd89644fe7',
    'datasets/hosp/labevents.csv.gz': 'd51a4cf1ea63245abe7d544b0d50a928e9ee2ec5eb9a5ce85500aed0bd6c6dfc',
    'datasets/hosp/d_labitems.csv.gz': '72ea5f020469fd24543bd98ab3bd0a4f645a5a4b7802d9d52af20d736f9d76db',
}
RULES = {
    'version': 'spp82-independent-mr01-mr09-v1',
    'source_system': 'lis-demo', 'seed_tag': 'DACN-MIMIC22-SOURCE-ALIGNED-V2',
    'result_system': 'https://example.org/lis/result', 'patient_system': 'https://example.org/lis/patient',
    'test_system': 'https://example.org/lis/test-code',
    'category_system': 'http://terminology.hl7.org/CodeSystem/observation-category',
    'category_code': 'laboratory', 'subject_type': 'Patient', 'clinical_status': 'final',
    'source_status': 'FINAL', 'resource_type': 'Observation',
    'context_separator': ' / ', 'decimal_rule': 'exact-coefficient-and-exponent-no-rounding',
    'timestamp_rule': 'Gregorian-instant-with-all-fractional-digits; raw-charttime-assumed-UTC',
    'fhir_scope': 'project-supported-subset; exact keys; no full-HL7-conformance-claim',
}

def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def insert_rows(text, table):
    """Strict parser for this pinned seed's single-line literal VALUES tuples. No SQL execution."""
    block = re.search(r'INSERT INTO ' + re.escape(table) + r' \(([^)]+)\) VALUES\n(.*?)\nON CONFLICT', text, re.S)
    require(block is not None, 'Missing seed block: ' + table)
    columns = [c.strip() for c in block[1].split(',')]
    result = []
    token = re.compile(r"\s*(?:'((?:[^']|'')*)'(?:\:\:(?:jsonb|timestamptz))?|(NULL)|(-?\d+(?:\.\d+)?))(?:\s*)(,|$)")
    for line in block[2].splitlines():
        line = line.strip().removesuffix(',')
        require(line.startswith('(') and line.endswith(')'), 'Unsupported seed tuple')
        body = line[1:-1]; values = []; position = 0
        while position < len(body):
            match = token.match(body, position)
            require(match is not None, 'Unsupported SQL literal')
            values.append(match[1].replace("''", "'") if match[1] is not None else None if match[2] else match[3])
            position = match.end()
        require(len(values) == len(columns), 'Seed column count mismatch')
        result.append(dict(zip(columns, values)))
    return result


def decimal_equal(a, b):
    return a == b if a is None or b is None else Decimal(a) == Decimal(b)


def freeze(oracle_path, oracle_sha256, output):
    require(not output.exists(), 'Output directory must be new')
    upstream = oracle_path.read_bytes()
    require(digest(upstream) == oracle_sha256, 'Upstream oracle checksum mismatch')
    for name, checksum in PINNED.items():
        require(digest((ROOT / name).read_bytes()) == checksum, 'Pinned source checksum mismatch: ' + name)
    expected_csv = list(csv.DictReader(io.StringIO(upstream.decode('utf-8-sig'))))
    require(len(expected_csv) == 1000, 'Oracle must contain exactly 1000 rows')
    require(len({r['expected_result_id'] for r in expected_csv}) == 1000, 'Duplicate oracle identity')
    reference = (ROOT / 'database/seed/01_reference_data.sql').read_text()
    links = insert_rows(reference, 'emr.patient_links')
    patients = {r['patient_id']: r for r in insert_rows(reference, 'lis.patients')}
    emr_patients = {r['patient_key'] for r in insert_rows(reference, 'emr.patients')}
    catalog = {r['test_code']: r for r in insert_rows(reference, 'lis.test_catalog')}
    seed = {r['result_id']: r for r in insert_rows((ROOT / 'database/seed/02_lis_results.sql').read_text(), 'lis.results')}
    require(len(links) == 100 and len({(r['identifier_system'], r['identifier_value']) for r in links}) == 100,
            'Invalid reference patient links')
    link_keys = {(r['identifier_system'], r['identifier_value']): r['patient_key'] for r in links}
    require(set(seed) == {r['expected_result_id'] for r in expected_csv}, 'Seed/oracle population mismatch')
    selected = {r['source_labevent_id'] for r in expected_csv}
    with gzip.open(ROOT / 'datasets/hosp/labevents.csv.gz', 'rt', newline='') as handle:
        raw = {}; indices = {}
        for index, row in enumerate(csv.DictReader(handle), 2):
            if row['labevent_id'] in selected:
                require(row['labevent_id'] not in raw, 'Duplicate selected raw labevent')
                raw[row['labevent_id']] = row; indices[row['labevent_id']] = index
    require(len(raw) == 1000, 'Missing source CSV rows')
    with gzip.open(ROOT / 'datasets/hosp/d_labitems.csv.gz', 'rt', newline='') as handle:
        raw_catalog = {r['itemid']: r for r in csv.DictReader(handle)}
    records = []
    for answer in expected_csv:
        rid = answer['expected_result_id']; source = raw[answer['source_labevent_id']]; seeded = seed[rid]
        patient = 'MIMIC-P-' + source['subject_id']; test = catalog[source['itemid']]; item = raw_catalog[source['itemid']]
        key = link_keys[(RULES['patient_system'], patient)]
        require(key in emr_patients and patients[patient]['source_subject_id'] == source['subject_id'], 'Patient reference mismatch')
        require(rid == 'MIMIC-LAB-' + source['labevent_id'], 'Source identity mismatch')
        require(int(answer['source_row_index']) == indices[source['labevent_id']], 'Raw CSV row index mismatch')
        require(all(test[k] == item[v] for k, v in [('test_name','label'),('fluid','fluid'),('category','category')]), 'Catalog/raw mismatch')
        low = source['ref_range_lower'] or None; high = source['ref_range_upper'] or None
        at = source['charttime'].replace(' ', 'T') + 'Z'
        context = ' / '.join(v for v in [item['label'], item['fluid'], item['category']] if v.strip())
        expected = {
            'expected_result_id': rid, 'MR01_identifier_system': RULES['result_system'], 'MR01_identifier_value': rid,
            'MR02_subject_type': 'Patient', 'MR02_subject_system': RULES['patient_system'], 'MR02_subject_value': patient,
            'MR02_expected_patient_key': key, 'MR03_code_system': RULES['test_system'], 'MR03_code': source['itemid'],
            'MR03_display': item['label'], 'MR04_value': source['valuenum'], 'MR05_unit': source['valueuom'],
            'MR06_low': low or '', 'MR06_high': high or '', 'MR06_range_present': str(low is not None or high is not None).lower(),
            'MR07_effectiveDateTime': at, 'MR08_status': 'final', 'MR09_category_system': RULES['category_system'],
            'MR09_category_code': 'laboratory', 'MR09_code_text': context,
            'expected_emr_external_system': RULES['result_system'], 'expected_emr_external_id': rid, 'expected_emr_patient_key': key,
            'expected_emr_analyte_system': RULES['test_system'], 'expected_emr_analyte_code': source['itemid'],
            'expected_emr_analyte_display': item['label'], 'expected_emr_analyte_context': context,
            'expected_emr_quantity': source['valuenum'], 'expected_emr_unit': source['valueuom'],
            'expected_emr_low': low or '', 'expected_emr_high': high or '', 'expected_emr_effective_at': at,
            'expected_emr_clinical_status': 'final', 'expected_emr_record_count': '1', 'expected_exchange_state': 'DELIVERED',
            'source_file_sha256': PINNED['datasets/hosp/labevents.csv.gz'], 'oracle_origin': 'independent_raw_csv_not_mapper',
        }
        decimals = {'MR04_value','MR06_low','MR06_high','expected_emr_quantity','expected_emr_low','expected_emr_high'}
        for field, value in expected.items():
            actual = answer[field]
            require(decimal_equal(actual or None, value or None) if field in decimals else actual == value,
                    f'Oracle/raw discrepancy: {rid}/{field}')
        for field, value in {'result_id': rid,'patient_id': patient,'test_code': source['itemid'],'value_num': source['valuenum'],
                             'unit': source['valueuom'],'reference_low': low,'reference_high': high,'effective_at': at,'result_status': 'FINAL'}.items():
            require(decimal_equal(seeded[field], value) if field in {'value_num','reference_low','reference_high'} else seeded[field] == value,
                    f'Seed/raw discrepancy: {rid}/{field}')
        provenance = json.loads(seeded['provenance'])
        require(provenance['seed_tag'] == RULES['seed_tag'] and provenance['source_labevent_id'] == source['labevent_id'], 'Seed provenance mismatch')
        records.append({'result_id': rid, 'source_labevent_id': source['labevent_id'], 'patient_id': patient, 'patient_key': key,
                        'test_code': source['itemid'], 'test_name': item['label'], 'fluid': item['fluid'], 'category': item['category'],
                        'value_num': answer['MR04_value'], 'unit': source['valueuom'], 'low': answer['MR06_low'] or None,
                        'high': answer['MR06_high'] or None, 'effective_at': at, 'result_status': 'FINAL', 'context': context})
    output.mkdir(parents=True, mode=0o700)
    def write(name, value):
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
        (output / name).write_text(text); return digest(text.encode())
    data = ''.join(json.dumps(r, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + '\n' for r in sorted(records, key=lambda r:r['result_id']))
    (output / 'expected.jsonl').write_text(data)
    (output / 'upstream-answers.csv').write_bytes(upstream)
    links_hash = write('patient-links.json', sorted(links, key=lambda r:r['identifier_value']))
    rules_hash = write('rules.json', RULES)
    manifest = {'schema_version': 1, 'population': 1000, 'dataset': 'SPP-65-MIMIC-IV-demo-2.2',
                'provenance': {'kind': 'handoff-oracle-crosschecked-against-raw-csv-and-versioned-seed',
                               'upstream_filename': oracle_path.name, 'upstream_sha256': oracle_sha256,
                               'preparation_script_sha256': digest(Path(__file__).read_bytes()),
                               'sources': PINNED, 'source_rows_crosschecked': 1000, 'patient_links_crosschecked': 100,
                               'limitations': ['Original manifest_1000.csv and upstream lock checksum were not found in available handoff.',
                                              'This is a local reference freeze, not SPP-65 owner sign-off.',
                                              'Raw charttime has no timezone: UTC and FINAL are declared project assumptions.']},
                'files': {'expected.jsonl': digest(data.encode()), 'patient-links.json': links_hash,
                          'rules.json': rules_hash, 'upstream-answers.csv': oracle_sha256}}
    checksum = write('manifest.json', manifest)
    (output / 'manifest.sha256').write_text(checksum + '\n')
    print(json.dumps({'frozen_population': 1000, 'patient_links': len(links), 'manifest_sha256': checksum}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle-csv', type=Path, required=True)
    parser.add_argument('--oracle-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    freeze(args.oracle_csv, args.oracle_sha256, args.output)
