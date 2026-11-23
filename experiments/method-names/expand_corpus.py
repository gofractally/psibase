#!/usr/bin/env python3
"""Merge pinned extraction shards without rewriting the historical experiment."""
import hashlib
import json
from collections import Counter
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
BASE_GROUPS = {
    'googleapis': ('service-api', 'google'),
    'kubernetes': ('service-api', 'kubernetes'),
    'ethereum': ('blockchain', 'ethereum'),
    'typescript-dom': ('javascript', 'microsoft'),
    'typescript-es': ('javascript', 'microsoft'),
    'ccxt': ('javascript', 'ccxt'),
    'ethers': ('javascript', 'ethers'),
}
SHARDS = [('corpus.jsonl', 'corpus-metadata.json'),
          ('expansion-cpp.jsonl', 'expansion-cpp-metadata.json'),
          ('expansion-rust.jsonl', 'expansion-rust-metadata.json'),
          ('expansion-apis.jsonl', 'expansion-apis-metadata.json')]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    records, inputs = [], []
    for filename, metadata in SHARDS:
        raw = (HERE / filename).read_bytes()
        meta = (HERE / metadata).read_bytes()
        provenance = json.loads(meta)
        assert digest(raw) == provenance['corpus_sha256'], filename
        inputs.append({'file': filename, 'sha256': digest(raw),
                       'metadata': metadata, 'metadata_sha256': digest(meta)})
        for line in raw.decode().splitlines():
            row = json.loads(line)
            for field in ('source', 'kind', 'service', 'split_group', 'method', 'path', 'revision'):
                assert isinstance(row[field], str) and row[field], (filename, field, row)
            assert re.fullmatch(r'[0-9a-f]{40}', row['revision']), row
            assert provenance['sources'][row['source']]['revision'] == row['revision'], row
            assert re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', row['method']), row
            if row['source'] in BASE_GROUPS:
                row['ecosystem'], row['provider'] = BASE_GROUPS[row['source']]
            if row.get('ecosystem') == 'vendor-sdk':
                row['ecosystem'] = 'service-api'
            assert row.get('ecosystem') and row.get('provider'), row
            records.append(row)
    keys = lambda row: (row['source'], row['service'], row['method'], row['path'], row['kind'])
    assert len({keys(row) for row in records}) == len(records), 'duplicate declaration record'
    records.sort(key=keys)
    sources = {}
    for source in sorted({row['source'] for row in records}):
        rows = [row for row in records if row['source'] == source]
        groups = {(row['ecosystem'], row['provider']) for row in rows}
        assert len(groups) == 1, (source, groups)
        ecosystem, provider = next(iter(groups))
        sources[source] = {'declarations': len(rows),
                           'unique_spellings': len({row['method'] for row in rows}),
                           'unique_lowercase': len({row['method'].lower() for row in rows}),
                           'families': len({row['split_group'] for row in rows}),
                           'ecosystem': ecosystem, 'provider': provider}
    raw = ''.join(json.dumps(row, sort_keys=True) + '\n' for row in records).encode()
    (HERE / 'corpus-expanded.jsonl').write_bytes(raw)
    output = {'scope': 'Pinned external declaration data; historical corpus is unchanged',
              'inputs': inputs, 'sha256': digest(raw), 'records': len(records),
              'unique_spellings': len({row['method'] for row in records}),
              'unique_lowercase': len({row['method'].lower() for row in records}),
              'ecosystems': dict(sorted(Counter(row['ecosystem'] for row in records).items())),
              'sources': sources}
    (HERE / 'corpus-expanded-metadata.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({key: output[key] for key in ('records', 'unique_spellings', 'unique_lowercase', 'ecosystems')}))


if __name__ == '__main__':
    main()
