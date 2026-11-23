#!/usr/bin/env python3
"""Reproduce source-site counts, not runtime action traffic measurements."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def main():
    manual, typed, hashes = [], [], {}
    for path in sorted((ROOT/'packages').rglob('*.rs')):
        if path.name=='bindings.rs' or any(part in path.parts for part in ('target','node_modules','dist')):
            continue
        text=path.read_text(errors='replace')
        relative=str(path.relative_to(ROOT))
        for match in re.finditer(r'(?<!fn )\badd_action_to_transaction\s*\(',text):
            argument=text[match.end():].split(',',1)[0].strip()
            category=('generated_ACTION_NAME' if 'ACTION_NAME' in argument else
                      'literal' if re.match(r'^&?\s*"',argument) else 'runtime_or_wrapper')
            manual.append({'path':relative,'line':text.count('\n',0,match.start())+1,
                           'first_argument':argument,'category':category})
        for match in re.finditer(r'(?:\.|::)add_to_tx\s*\(',text):
            typed.append({'path':relative,'line':text.count('\n',0,match.start())+1})
        if any(row['path']==relative for row in manual+typed):
            hashes[relative]=hashlib.sha256(path.read_bytes()).hexdigest()
    report={'scope':'StaticRust package source sites; generatedbindings/externalbuilds excluded; not execution counts',
            'manual':{'sites':len(manual),'files':len({r['path'] for r in manual}),
                      'categories':dict(Counter(r['category'] for r in manual)),'entries':manual},
            'typed':{'sites':len(typed),'files':len({r['path'] for r in typed}),'entries':typed},
            'union_files':len({r['path'] for r in manual+typed}),'source_sha256':hashes}
    (HERE/'usage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({key:({k:v for k,v in value.items() if k!='entries'} if isinstance(value,dict) else value)
                      for key,value in report.items() if key!='source_sha256'},indent=2))


if __name__=='__main__':main()
