#!/usr/bin/env python3
"""Pinned external company SDK and blockchain RPC declaration collector.

Sources are read as data, never imported or executed. Archive members are read
in memory without filesystem extraction. The intentionally source-specific
lexical parsers select declaration/registration sites, not arbitrary calls.
Run --self-test to check positive/negative extraction fixtures offline.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
from corpus import cached, declaration_records, proto_records, sha

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / 'build-method-names/corpus-cache'
META = HERE / 'expansion-apis-metadata.json'
# Frozen upstream revisions. These are identifier research inputs, not software
# version recommendations; AWS v2 and the original Solana repository are useful
# independent historical naming samples even though their maintenance changed.
SOURCES = {
 'bitcoin-rpc': {'repo':'bitcoin/bitcoin','revision':'19128e8b77553e4362fcbf3cb8f3f7dc5a2e4253','license':'MIT','provider':'Bitcoin Core','ecosystem':'blockchain'},
 'solana-rpc': {'repo':'solana-labs/solana','revision':'7700cb3128c1f19820de67b81aa45d18f73d2ac0','license':'Apache-2.0','provider':'Solana Labs','ecosystem':'blockchain'},
 'polkadot-rpc': {'repo':'paritytech/polkadot-sdk','revision':'54c21d97b0b77c95919363c76a93183bbe51dab4','license':'GPL-3.0-or-later WITH Classpath-exception-2.0 (per-file); Apache-2.0','provider':'Parity','ecosystem':'blockchain'},
 'cosmos-rpc': {'repo':'cosmos/cosmos-sdk','revision':'0c3dd0e3eb5413ea86fddaa9e8fbe8c16fda815b','license':'Apache-2.0','provider':'Cosmos SDK','ecosystem':'blockchain'},
 'cometbft-rpc': {'repo':'cometbft/cometbft','revision':'2abce49280c10c5f39b58ed399da931a3a050796','license':'Apache-2.0','provider':'CometBFT','ecosystem':'blockchain'},
 'aws-sdk': {'repo':'aws/aws-sdk-js','revision':'9d3c66eca8c4416a9d347d0703f27b65775d65ef','license':'Apache-2.0','provider':'Amazon','ecosystem':'vendor-sdk'},
 'stripe-sdk': {'repo':'stripe/stripe-node','revision':'dd924299e2517e2b4e3b571aa7f20f295289ea71','license':'MIT','provider':'Stripe','ecosystem':'vendor-sdk'},
 'github-sdk': {'repo':'octokit/plugin-rest-endpoint-methods.js','revision':'72b969439000425a16b46c61f369a3c9d52c2b0f','license':'MIT','provider':'GitHub/Octokit','ecosystem':'vendor-sdk'},
}


def comments_hidden(text):
    # Preserve quoted strings because wire declarations use string literals;
    # hide comments, including comment examples, without changing offsets.
    token = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/'
    def hide(m):
        if m[0].startswith(('//','/*')):
            return re.sub(r'[^\n]', ' ', m[0])
        return m[0]
    return re.sub(token, hide, text)


def block_end(text, opening, rust=False):
    # Called on comment-hidden text. Hide strings before counting braces so
    # HTTP templates, quoted JSON examples and method bodies cannot interfere.
    depth, cursor = 1, opening + 1
    while cursor < len(text) and depth:
        if text[cursor] in ('"', '`') or (text[cursor] == "'" and (not rust or re.match(r"'(?:\\.|[^'\\])'", text[cursor:]))):
            quote = text[cursor]
            cursor += 1
            while cursor < len(text):
                if text[cursor] == '\\': cursor += 2; continue
                if text[cursor] == quote: break
                cursor += 1
        elif text[cursor] == '{': depth += 1
        elif text[cursor] == '}': depth -= 1
        cursor += 1
    if depth: raise ValueError('Unclosed declaration body')
    return cursor


def simple_record(source, kind, service, name, path, revision):
    return {'source':source, 'kind':kind, 'service':service,
            'split_group':source+':'+service, 'method':name,
            'path':path, 'revision':revision}


def bitcoin_records(path, text, revision):
    clean = comments_hidden(text)
    # RPCMethod (historically RPCHelpMan) begins with the public wire name. It is
    # a definition used by the RPC registration tables, not a C++ callsite name.
    for match in re.finditer(r'\b(?:RPCMethod|RPCHelpMan)\s*\{\s*"([A-Za-z_][A-Za-z0-9_]*)"', clean):
        service = path.removesuffix('.cpp').replace('/', '.')
        yield simple_record('bitcoin-rpc','bitcoin_rpc_method_declaration',service,match[1],path,revision)


def solana_records(path, text, revision):
    clean = comments_hidden(text)
    start = clean.index('impl fmt::Display for RpcRequest')
    opening = clean.index('{', start)
    stop = block_end(clean, opening, rust=True)
    for match in re.finditer(r'\bRpcRequest::[A-Za-z_]\w*\s*=>\s*"([A-Za-z_]\w*)"', clean[opening:stop]):
        yield simple_record('solana-rpc','json_rpc_display_mapping','RpcRequest',match[1],path,revision)


def polkadot_records(path, text, revision):
    clean = comments_hidden(text)
    for trait in re.finditer(r'#\[rpc\((.*?)\)\]\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)', clean, re.S):
        namespace = re.search(r'\bnamespace\s*=\s*"([A-Za-z_]\w*)"', trait[1])
        opening = clean.index('{', trait.end())
        stop = block_end(clean, opening, rust=True)
        service = path.removesuffix('.rs').replace('/', '.')+'.'+trait[2]
        for attr in re.finditer(r'#\[(method|subscription)\s*\((.*?)\)\]', clean[opening:stop], re.S):
            names = []
            name = re.search(r'\bname\s*=\s*"([A-Za-z_]\w*)"', attr[2])
            if name: names.append((name[1], 'json_rpc_method' if attr[1]=='method' else 'json_rpc_subscribe'))
            unsub = re.search(r'\bunsubscribe\s*=\s*"([A-Za-z_]\w*)"',attr[2])
            if unsub: names.append((unsub[1], 'json_rpc_unsubscribe'))
            for aliases in re.finditer(r'\b(?:aliases|unsubscribe_aliases)\s*=\s*\[([^\]]*)\]',attr[2]):
                names.extend((m[1], 'json_rpc_explicit_alias') for m in re.finditer(r'"([A-Za-z_]\w*)"', aliases[1]))
            for name,kind in names:
                if namespace: name = namespace[1]+'_'+name
                yield simple_record('polkadot-rpc',kind,service,name,path,revision)


def comet_records(path,text,revision):
    clean = comments_hidden(text)
    for match in re.finditer(r'"([A-Za-z_]\w*)"\s*:\s*(?:rpc|jsonrpc)\.New(?:WS)?RPCFunc\s*\(', clean):
        yield simple_record('cometbft-rpc','json_rpc_route_registration','CometBFT',match[1],path,revision)


def octokit_records(path,text,revision):
    clean = comments_hidden(text)
    groups = list(re.finditer(r'(?m)^  ([A-Za-z_]\w*): \{\s*$',clean))
    for i,group in enumerate(groups):
        stop = groups[i+1].start() if i+1 < len(groups) else len(clean)
        content = clean[group.end():stop]
        for match in re.finditer(r'(?m)^    ([A-Za-z_]\w*): \{\s*\n\s*\(',content):
            yield simple_record('github-sdk','typescript_callable_resource_property',group[1],match[1],path,revision)


def records_for(source,path,text,revision):
    if source=='bitcoin-rpc': return list(bitcoin_records(path,text,revision))
    if source=='solana-rpc': return list(solana_records(path,text,revision))
    if source=='polkadot-rpc': return list(polkadot_records(path,text,revision))
    if source=='cometbft-rpc': return list(comet_records(path,text,revision))
    if source=='github-sdk': return list(octokit_records(path,text,revision))
    if source=='cosmos-rpc':
        rows=list(proto_records(path,text,revision))
        for row in rows:
            row['source']=source
            row['split_group']=row['split_group'].replace('googleapis:',source+':',1)
        return rows
    rows=list(declaration_records(source,path,text,revision,'class'))
    for row in rows:
        row['service']=path.removesuffix('.d.ts').removesuffix('.ts').replace('/','.')+'.'+row['service']
        row['split_group']=source+':'+row['service']
        row['kind']='typescript_sdk_class_method'
    return [row for row in rows if row['method'] not in ('constructor','new')]


def selected(source,path):
    if source=='bitcoin-rpc': return path.endswith('.cpp') and (path.startswith('src/rpc/') or path.startswith('src/wallet/rpc/')) and '/test' not in path
    if source=='cosmos-rpc': return path.startswith('proto/cosmos/') and path.endswith('.proto') and not any(x in path for x in ('/test/','/testdata/','/testutil/','/internal/'))
    if source=='cometbft-rpc': return path=='rpc/core/routes.go'
    if source=='aws-sdk': return path.startswith('clients/') and path.count('/')==1 and path.endswith('.d.ts') and not Path(path).name.startswith('all')
    if source=='stripe-sdk': return path.startswith('src/resources/') and path.endswith('.ts') and not path.endswith('/index.ts')
    return False


def fetch_raw(source,repo,revision,path):
    url=f'https://raw.githubusercontent.com/{repo}/{revision}/{path}'
    data=cached(url,CACHE/f'{source}-{revision}-{path.replace("/","_")}')
    return path,data,{'path':path,'url':url,'sha256':sha(data),'bytes':len(data)}


def collect(source,previous):
    info=dict(SOURCES[source]);repo=info.pop('repo');revision=info['revision']
    info.update(repository=repo,url=f'https://github.com/{repo}',downloaded_code_executed=False)
    old=previous.get(source,{})
    rows=[];files=[];licenses=[];inspected=0
    license_dir=HERE/'licenses/apis';license_dir.mkdir(parents=True,exist_ok=True)
    def keep_license(path,data):
        out=license_dir/f'{source}-{path.replace("/","_")}'
        out.write_bytes(data)
        licenses.append({'path':path,'sha256':sha(data),'local_path':str(out.relative_to(HERE)),
                         'url':f'https://github.com/{repo}/blob/{revision}/{path}'})
    if source in ('solana-rpc','github-sdk','polkadot-rpc'):
        if source=='solana-rpc': paths=['rpc-client-api/src/request.rs'];license_paths=['LICENSE']
        elif source=='github-sdk': paths=['src/generated/method-types.ts'];license_paths=['LICENSE']
        else:
            url=f'https://api.github.com/repos/{repo}/git/trees/{revision}?recursive=1'
            data=cached(url,CACHE/f'polkadot-{revision}-tree.json')
            tree=json.loads(data)
            if tree.get('truncated'):raise ValueError('Incomplete Polkadot tree')
            info['listing_sha256']=sha(data)
            paths=[r['path'] for r in tree['tree'] if r['type']=='blob' and r['path'].endswith('.rs')
                   and ('rpc-api/src/' in r['path'] or ('/rpc/' in r['path'] and r['path'].endswith('src/lib.rs')))]
            license_paths=['substrate/LICENSE-APACHE2','substrate/LICENSE-GPL3']
        with ThreadPoolExecutor(max_workers=6) as pool:
            downloads=list(pool.map(lambda p:fetch_raw(source,repo,revision,p),sorted(paths+license_paths)))
        for path,data,item in downloads:
            files.append(item)
            if path in license_paths:keep_license(path,data)
            else:
                inspected+=1
                rows.extend(records_for(source,path,data.decode('utf-8'),revision))
        digest=sha(json.dumps(files,sort_keys=True).encode())
        info.update(download_kind='pinned raw files',download_sha256=digest,
                    download_bytes=sum(item['bytes'] for item in files),downloads=files)
    else:
        url=f'https://codeload.github.com/{repo}/tar.gz/{revision}'
        data=cached(url,CACHE/f'{source}-{revision}.tar.gz')
        info.update(download_kind='pinned source archive',download_url=url,
                    download_sha256=sha(data),download_bytes=len(data))
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
            for member in archive:
                if not member.isfile():continue
                path=member.name.split('/',1)[1]
                if path in ('LICENSE','LICENSE.txt','LICENSE.md','COPYING','NOTICE'):
                    keep_license(path,archive.extractfile(member).read())
                if selected(source,path):
                    inspected+=1
                    contents=archive.extractfile(member).read()
                    files.append({'path':path,'sha256':sha(contents),'bytes':len(contents)})
                    rows.extend(records_for(source,path,contents.decode('utf-8'),revision))
        info['definition_file_hashes']=files
    if old.get('revision')==revision and old.get('download_sha256')!=info['download_sha256']:
        raise ValueError(f'Pinned download digest changed: {source}')
    if not rows: raise ValueError('No declarations extracted: '+source)
    if not licenses: raise ValueError('No upstream license copied: '+source)
    seen=set();unique=[]
    for row in rows:
        key=(row['service'],row['method'],row['path'])
        if key in seen:continue
        seen.add(key)
        row.update(ecosystem=info['ecosystem'],provider=info['provider'],language='typescript' if info['ecosystem']=='vendor-sdk' else {'bitcoin-rpc':'c++','solana-rpc':'rust','polkadot-rpc':'rust','cosmos-rpc':'protobuf','cometbft-rpc':'go'}[source])
        unique.append(row)
    rows=sorted(unique,key=lambda r:(r['service'],r['method'],r['path']))
    info.update(records=len(rows),unique_methods=len({r['method'] for r in rows}),
                services=len({r['service'] for r in rows}),split_groups=len({r['split_group'] for r in rows}),
                definition_files_inspected=inspected,licenses=licenses,
                kind_counts=dict(Counter(r['kind'] for r in rows)))
    return source,info,rows


def self_test():
    rev='0'*40
    assert [r['method'] for r in bitcoin_records('src/rpc/a.cpp','// RPCHelpMan{"fake"}\n return RPCHelpMan{ "getblock", "help"};',rev)]==['getblock']
    fixture='''#[rpc(client, server, namespace = "system")] pub trait Api { #[method(name = "health", aliases = ["isHealthy"])] fn health(); #[subscription(name = "subscribeHeads" => "newHead", unsubscribe = "unsubscribeHeads")] fn sub(); }'''
    assert [r['method'] for r in polkadot_records('api.rs',fixture,rev)]==['system_health','system_isHealthy','system_subscribeHeads','system_unsubscribeHeads']
    assert [r['method'] for r in comet_records('routes.go','"status": rpc.NewRPCFunc(Status, ""), "fake": someCall()',rev)]==['status']
    fixture='''export type RestEndpointMethods = {\n  users: {\n    getByUsername: {\n      (params: P): Promise<R>;\n      defaults: D;\n    };\n  };\n};'''
    assert [r['method'] for r in octokit_records('types.ts',fixture,rev)]==['getByUsername']
    fixture='''declare class Service { constructor(a: T); getThing(a: T): R;\n  getThing(a: U): R;\n  privateThing: string;\n  doOtherThing(): R;\n}'''
    # Fixture intentionally follows the source's line-oriented declarations.
    rows=records_for('aws-sdk','clients/example.d.ts',fixture,rev)
    assert {r['method'] for r in rows}=={'getThing','doOtherThing'}
    fixture='''export class Resource {\n retrieve(id: string): Promise<R> {\n return this._makeRequest(`path/${id}`);\n }\n update(id: string): Promise<R> { return this.retrieve(id); }\n}'''
    assert {r['method'] for r in records_for('stripe-sdk','src/resources/Foo.ts',fixture,rev)}=={'retrieve','update'}
    fixture='impl fmt::Display for RpcRequest { fn fmt(&self, f: &mut fmt::Formatter<\'_>) -> fmt::Result { match self { RpcRequest::GetBlock => \"getBlock\" } } }'
    assert [r['method'] for r in solana_records('request.rs',fixture,rev)]==['getBlock']
    print('API declaration extraction fixtures passed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test',action='store_true')
    args=parser.parse_args()
    if args.self_test:self_test();return
    CACHE.mkdir(parents=True,exist_ok=True)
    previous=json.loads(META.read_text()).get('sources',{}) if META.exists() else {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda source:collect(source,previous),SOURCES))
    rows=[r for _,_,batch in results for r in batch]
    output=HERE/'expansion-apis.jsonl'
    temporary=output.with_suffix('.jsonl.tmp')
    temporary.write_text(''.join(json.dumps(r,sort_keys=True)+'\n' for r in rows))
    temporary.replace(output)
    metadata={'purpose':'Independent company SDKs and blockchain wire API declarations for method-name research',
              'sources':{name:meta for name,meta,_ in results},'records':len(rows),
              'corpus_sha256':sha(output.read_bytes()),'downloaded_code_executed':False,
              'limitations':[
               'Source-specific lexical parsers select explicit RPC help/mapping/attribute declarations and SDK class or callable-property declarations; they are not complete language parsers.',
               'Bitcoin scope is production src/rpc and src/wallet/rpc; RPCMethod definitions do not prove every conditional RPC is enabled in every node build.',
               'Polkadot includes explicit aliases and unsubscribe methods but excludes subscription notification labels; only selected public RPC trait declaration locations are scanned.',
               'Solana is the archived original solana-labs repository, includes historical/deprecated wire mappings, and does not enumerate the custom dynamic variant.',
               'AWS is the official historical v2 JS service declarations; overloads coalesce within each service/file, constructors excluded. SDK version status is unrelated to its use as naming data.',
               'Stripe scans generated resource class declarations, excluding parameter interfaces and request-call expressions.',
               'Octokit scans declared callable resource properties, not route URLs or callsites. Generated long names are intentionally retained as a distinct vendor convention.',
               'Cosmos includes public proto/cosmos service RPCs and collapses API versions for split groups; generated HTTP routes are not harvested.',
               'Occurrences remain scoped by service/path. Distinct service declarations may reuse the same spelling; occurrence count is not unique-name count.',
              ]}
    temporary=META.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(metadata,indent=2,sort_keys=True)+'\n')
    temporary.replace(META)
    print(json.dumps({name:{k:m[k] for k in ('records','unique_methods','services','split_groups')} for name,m,_ in results},indent=2))

if __name__=='__main__':main()
