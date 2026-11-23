#!/usr/bin/env python3
"""Offline method-name codec experiment; never changes Psibase wire encoding.

Train on deduplicated Google RPC names from deterministic service-family groups;
hold out other Google families and all Ethereum/Kubernetes/Psibase names.
Prototype codecs have a NEW, INCOMPATIBLE format: top-bit tag +63-bit payload,
32-bit arithmetic coder, explicit EOS, and positive 15-bit quantized frequencies.
Lossy candidates are labeled separately. No production codec is replaced.
"""
import argparse
import ast
from bisect import bisect_right
from collections import Counter, defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import string
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ALPHABET = string.ascii_lowercase + string.digits + '_'
TOTAL = 32768
TAG = 1 << 63
MAX = (1 << 32) - 1
HALF = 1 << 31
QUARTER = 1 << 30
THREE_QUARTERS = 3 << 30
EOS = '\0'


def lower(name):
    return name.lower()


def lookalike(name):
    return name.lower().translate(str.maketrans({'o': '0', 'l': '1'}))


def vowels(name):
    return '_'.join(part[:1] + re.sub('[aeiou]', '', part[1:])
                    for part in name.lower().split('_'))


def legacy(name):
    return name.lower().translate(str.maketrans('0123456789_', 'eaiotnrslcq'))


def quantize(weights):
    size = len(weights)
    scale = TOTAL - size
    total = sum(weights)
    raw = [x / total * scale for x in weights]
    counts = [1 + int(x) for x in raw]
    for index in sorted(range(size), key=lambda i: (-(raw[i] - int(raw[i])), i))[:TOTAL-sum(counts)]:
        counts[index] += 1
    cdf = [0]
    for count in counts:
        cdf.append(cdf[-1] + count)
    assert cdf[-1] == TOTAL and all(a < b for a, b in zip(cdf, cdf[1:]))
    return cdf


def normalized_weights(names, normalize, weights=None):
    """One vote per canonical spelling by default; optional weighted corpus.

    Weighted models preserve relative mass while scaling it to the number of
    distinct canonical spellings, keeping smoothing comparable to the original
    unweighted experiment. This is research training data, not wire-format data.
    """
    if weights is None:
        return {name: 1 for name in sorted({normalize(name) for name in names})}
    counts = Counter()
    for name in sorted(set(names)):
        counts[normalize(name)] += weights[name]
    scale = len(counts) / sum(counts.values())
    return {name: weight * scale for name, weight in sorted(counts.items())}


class CharacterModel:
    def __init__(self, names, order, normalize=lower, alphabet=ALPHABET, weights=None):
        self.normalize = normalize
        self.order = order
        self.symbols = [EOS] + list(alphabet)
        self.indices = {value: index for index, value in enumerate(self.symbols)}
        self.counts = [defaultdict(Counter) for _ in range(order + 1)]
        self.cache = {}
        for name, weight in normalized_weights(names, normalize, weights).items():
            context = '^' * order
            for char in name + EOS:
                for depth in range(order + 1):
                    self.counts[depth][context[-depth:] if depth else ''][char] += weight
                context += char
        self.base = [self.counts[0][''][char] + 1 for char in self.symbols]
        base_sum = sum(self.base)
        self.base = [x / base_sum for x in self.base]

    def tokenize(self, name):
        normalized = self.normalize(name)
        if any(char not in self.indices for char in normalized):
            raise ValueError(name)
        return list(normalized)

    def distribution(self, context):
        context = ('^' * self.order + context)[-self.order:] if self.order else ''
        if context in self.cache:
            return self.cache[context]
        probabilities = self.base
        for depth in range(1, self.order + 1):
            row = self.counts[depth].get(context[-depth:])
            if row:
                count = sum(row.values())
                alpha = 16
                probabilities = [(row[symbol] + alpha * prior) / (count + alpha)
                                 for symbol, prior in zip(self.symbols, probabilities)]
        result = quantize(probabilities)
        self.cache[context] = result
        return result

    def next_context(self, context, token):
        return (context + token)[-self.order:] if self.order else ''

    def summary(self):
        return {'kind': 'character', 'order': self.order,
                'symbols_including_eos': len(self.symbols),
                'observed_context_rows': sum(len(x) for x in self.counts),
                'evaluated_cdf_rows': len(self.cache),
                'evaluated_cdf_u16_bytes': len(self.cache) * (len(self.symbols) + 1) * 2}


class CurrentTableControl:
    """Control: current table/aliases, experimental32bit coder, positive floors."""
    normalize = staticmethod(legacy)
    def __init__(self):
        text = (ROOT/'rust/psibase_names/src/constants.rs').read_text()
        literal = re.search(r'MODEL_CF_METHOD:.*?=\s*(\[[\s\S]*?\]);',text).group(1)
        rows = ast.literal_eval(literal)
        self.symbols = [EOS] + list('eaiotnrslcuhdpmygbfwvkzxqj')
        assert len(rows)==len(self.symbols)==27
        self.indices = {token:index for index,token in enumerate(self.symbols)}
        self.cdfs = [quantize([max(1,b-a) for a,b in zip(row,row[1:])]) for row in rows]
    def tokenize(self,name):return list(legacy(name))
    def distribution(self,context):return self.cdfs[self.indices[context[-1]] if context else 0]
    def next_context(self,context,token):return token
    def summary(self):return {'kind':'current_table_control','symbols_including_eos':27,
                              'changes':'same currentCDF/aliases, positivefloor,32bit coder,new63bitformat'}


class SubwordModel:
    def __init__(self, names, vocabulary):
        self.normalize = lower
        sequences = Counter(tuple(name) for name in {lower(value) for value in names})
        self.merges = []
        symbol_set = set(ALPHABET)
        while len(symbol_set) + 1 < vocabulary:
            pairs = Counter()
            for tokens, weight in sequences.items():
                for pair in zip(tokens, tokens[1:]):
                    pairs[pair] += weight
            if not pairs:
                break
            pair, frequency = min(pairs.items(), key=lambda x: (-x[1], x[0]))
            if frequency < 2:
                break
            merged = ''.join(pair)
            self.merges.append(pair)
            symbol_set.add(merged)
            updated = Counter()
            for tokens, weight in sequences.items():
                out, index = [], 0
                while index < len(tokens):
                    if index + 1 < len(tokens) and (tokens[index], tokens[index+1]) == pair:
                        out.append(merged)
                        index += 2
                    else:
                        out.append(tokens[index])
                        index += 1
                updated[tuple(out)] += weight
            sequences = updated
        self.ranks = {pair: rank for rank, pair in enumerate(self.merges)}
        self.symbols = [EOS] + sorted(symbol_set)
        self.indices = {token: index for index, token in enumerate(self.symbols)}
        counts = Counter()
        for tokens, weight in sequences.items():
            counts.update({token: tokens.count(token) * weight for token in set(tokens)})
            counts[EOS] += weight
        self.cdf = quantize([counts[token] + 1 for token in self.symbols])

    def tokenize(self, name):
        tokens = list(lower(name))
        if any(char not in ALPHABET for char in tokens):
            raise ValueError(name)
        while len(tokens) > 1:
            candidates = [(self.ranks[(a,b)], index)
                          for index, (a,b) in enumerate(zip(tokens, tokens[1:])) if (a,b) in self.ranks]
            if not candidates:
                break
            _, index = min(candidates)
            tokens[index:index+2] = [tokens[index] + tokens[index+1]]
        return tokens

    def distribution(self, context):
        return self.cdf

    def next_context(self, context, token):
        return ''

    def summary(self):
        return {'kind': 'bpe_unigram', 'symbols_including_eos': len(self.symbols),
                'merge_rules': len(self.merges),
                'dictionary_utf8_bytes': sum(len(x) for x in self.symbols),
                'cdf_u16_bytes': len(self.cdf) * 2}


class WordModel:
    """Global component dictionary; canonical text uses optimal unigram parsing."""
    normalize = staticmethod(lower)
    def __init__(self,names,vocabulary,weights=None):
        pieces=Counter()
        training=[]
        for name, weight in normalized_weights(names, lambda value: value, weights).items():
            words=re.findall(r'[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+|_',name)
            if ''.join(words).lower()!=name.lower():words=list(name)
            words=[word.lower() for word in words]
            training.append((words, weight))
            for word in words: pieces[word] += weight
        selected=[word for word,_ in sorted(pieces.items(),key=lambda x:(-x[1],x[0]))
                  if len(word)>1][:max(0,vocabulary-len(ALPHABET)-1)]
        self.symbols=[EOS]+list(ALPHABET)+selected
        self.indices={word:index for index,word in enumerate(self.symbols)}
        counts=Counter()
        for words, weight in training:
            for word in words:
                for token in ([word] if word in self.indices else list(word)):
                    counts[token] += weight
            counts[EOS] += weight
        self.cdf=quantize([counts[word]+1 for word in self.symbols])
        self.cost={word:-math.log2((self.cdf[i+1]-self.cdf[i])/TOTAL)
                   for i,word in enumerate(self.symbols)}
        self.trie={}
        for word in self.symbols[1:]:
            node=self.trie
            for char in word:node=node.setdefault(char,{})
            node[None]=word
        self.cache={}
    def tokenize(self,name):
        name=lower(name)
        if name in self.cache:return self.cache[name]
        paths=[None]*(len(name)+1);paths[0]=(0.0,[])
        for i in range(len(name)):
            if paths[i] is None:continue
            node=self.trie
            for j in range(i,len(name)):
                node=node.get(name[j])
                if node is None:break
                word=node.get(None)
                if word is not None:
                    cost=paths[i][0]+self.cost[word]
                    if paths[j+1] is None or cost<paths[j+1][0]:paths[j+1]=(cost,paths[i][1]+[word])
        assert paths[-1] is not None,name
        self.cache[name]=paths[-1][1]
        return self.cache[name]
    def distribution(self,context):return self.cdf
    def next_context(self,context,token):return ''
    def summary(self):return {'kind':'global_component_dictionary_viterbi_unigram',
                              'symbols_including_eos':len(self.symbols),
                              'dictionary_utf8_bytes':sum(len(x) for x in self.symbols),
                              'cdf_u16_bytes':2*len(self.cdf)}


class HybridModel:
    """Two tagged readable models:00=char2,01=BPE;62payloadbits each."""
    normalize = staticmethod(lower)
    def __init__(self, char_model, subword_model, literal=False):
        self.models = [char_model,subword_model]
        self.literal = literal
        self.mode_labels=['char2','bpe512' if isinstance(subword_model,SubwordModel) else 'component_dictionary']
    def encode(self,name):
        options = [(length,index,value) for index,model in enumerate(self.models)
                   for value,length in [encode(model,name)] if value is not None and length<=62]
        if self.literal:
            value=0
            for char in lower(name):value=value*len(ALPHABET)+ALPHABET.index(char)+1
            if 0<value<(1<<62):options.append((value.bit_length(),2,value))
        if not options:
            return None,min(encode(model,name)[1] for model in self.models)
        length,index,value = min(options)
        return (index<<62)|(value if index==2 else value>>1),length
    def decode(self,value):
        index = value>>62
        if index==2 and self.literal:
            number=value&((1<<62)-1)
            chars=[]
            while number:
                number,index=divmod(number-1,len(ALPHABET))
                chars.append(ALPHABET[index])
            return ''.join(reversed(chars))
        assert index in (0,1)
        return decode(self.models[index],(value&((1<<62)-1))<<1)
    def summary(self):return {'kind':'tagged_readable_mixture','tag_bits':2,'payload_bits':62,
                              'modes':self.mode_labels+(['bijective_base37_literal'] if self.literal else []),
                              'fallback':'not implemented'}


def encode(model, name):
    if isinstance(model,HybridModel):return model.encode(name)
    low, high, pending, context = 0, MAX, 0, ''
    bits = []
    def emit(bit):
        nonlocal pending
        bits.append(bit)
        bits.extend([1 - bit] * pending)
        pending = 0
    for token in model.tokenize(name) + [EOS]:
        cdf = model.distribution(context)
        index = model.indices[token]
        width = high - low + 1
        high, low = (low + width * cdf[index+1] // TOTAL - 1,
                     low + width * cdf[index] // TOTAL)
        assert low <= high
        while True:
            if high < HALF:
                emit(0)
            elif low >= HALF:
                emit(1)
                low -= HALF
                high -= HALF
            elif low >= QUARTER and high < THREE_QUARTERS:
                pending += 1
                low -= QUARTER
                high -= QUARTER
            else:
                break
            low <<= 1
            high = (high << 1) | 1
        context = model.next_context(context, token)
    pending += 1
    emit(0 if low < QUARTER else 1)
    if len(bits) > 63:
        return None, len(bits)
    result = 0
    for bit in bits:
        result = (result << 1) | bit
    result <<= 63 - len(bits)
    return (result if result else None), len(bits)


def decode(model, value):
    if isinstance(model,HybridModel):return model.decode(value)
    bits = [(value >> (62-i)) & 1 for i in range(63)]
    position = 0
    def take():
        nonlocal position
        bit = bits[position] if position < len(bits) else 0
        position += 1
        return bit
    low, high, context, code, out = 0, MAX, '', 0, []
    for _ in range(32):
        code = (code << 1) | take()
    for _ in range(1024):
        cdf = model.distribution(context)
        width = high - low + 1
        scaled = ((code - low + 1) * TOTAL - 1) // width
        index = bisect_right(cdf, scaled) - 1
        token = model.symbols[index]
        if token == EOS:
            return ''.join(out)
        out.append(token)
        high, low = (low + width * cdf[index+1] // TOTAL - 1,
                     low + width * cdf[index] // TOTAL)
        while True:
            if high < HALF:
                pass
            elif low >= HALF:
                code -= HALF
                low -= HALF
                high -= HALF
            elif low >= QUARTER and high < THREE_QUARTERS:
                code -= QUARTER
                low -= QUARTER
                high -= QUARTER
            else:
                break
            low <<= 1
            high = (high << 1) | 1
            code = (code << 1) | take()
        context = model.next_context(context, token)
    raise AssertionError('decoder did not reach EOS')


def local_methods():
    records = []
    paths = []
    for directory, folders, files in os.walk(ROOT / 'packages'):
        folders[:] = sorted(folder for folder in folders
                            if folder not in ('target', 'node_modules', 'dist', '.yarn', '.git'))
        paths.extend(Path(directory) / name for name in files if Path(name).suffix in ('.rs', '.hpp', '.cpp'))
    for path in sorted(paths):
        if path.suffix == '.rs' and path.name != 'bindings.rs':
            text = path.read_text(errors='replace')
            names = re.findall(r'#\[action(?:\([^]]*\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(?:r#)?(\w+)', text)
            kind = 'rust_action'
        elif path.suffix in ('.hpp','.cpp'):
            text = path.read_text(errors='replace')
            text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
            for macro in re.finditer(r'\bPSIO_REFLECT\s*\(', text):
                start, depth, end = macro.end(), 1, macro.end()
                while depth and end < len(text):
                    depth += (text[end] == '(') - (text[end] == ')')
                    end += 1
                if depth:
                    continue
                body = text[start:end-1]
                reflected_type = body.split(',',1)[0].strip()
                for name in re.findall(r'\bmethod\s*\(\s*([A-Za-z_]\w*)', body):
                    records.append({'source':'psibase','kind':'cpp_reflected_method',
                                    'service':str(path.relative_to(ROOT))+'::'+reflected_type,
                                    'split_group':'psibase:'+path.relative_to(ROOT).parts[2],
                                    'method':name,'path':str(path.relative_to(ROOT))})
            continue
            kind = 'cpp_reflected_method'
        else:
            continue
        for name in names:
            records.append({'source':'psibase','kind':kind,'service':str(path.relative_to(ROOT)),
                            'split_group':'psibase:'+path.relative_to(ROOT).parts[2],
                            'method':name,'path':str(path.relative_to(ROOT))})
    return records


def probe(path, names):
    result = subprocess.run([str(path)], input='\n'.join(names)+'\n', text=True,
                            capture_output=True, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        name, value, decoded, hashed = line.split('\t')
        rows[name] = {'value': value, 'decoded': decoded, 'hashed': hashed == '1', 'panic': value == 'PANIC'}
    assert set(rows) == set(names)
    return rows


def collisions(records, normalize):
    buckets = defaultdict(set)
    for row in records:
        original = lower(row['method'])
        buckets[(row['source'], row['service'], normalize(row['method']))].add(original)
    groups = [{'source': source, 'scope': scope, 'canonical': canonical, 'originals': sorted(originals)}
              for (source, scope, canonical), originals in sorted(buckets.items()) if len(originals) > 1]
    return {'groups':len(groups),'distinct_names_affected':sum(len(x['originals']) for x in groups),
            'examples':groups[:15]}


def wire_collisions(records, values):
    buckets = defaultdict(set)
    for row in records:
        encoded = values[row['method']]
        if not encoded['panic']:
            buckets[(row['source'],row['service'],encoded['value'])].add(row['method'].lower())
    groups = [{'source':source,'scope':scope,'value':value,'originals':sorted(names)}
              for (source,scope,value),names in sorted(buckets.items()) if len(names)>1]
    return {'groups':len(groups),'examples':groups[:15]}


def percentile(values, percent):
    values = sorted(values)
    return values[min(len(values)-1, int((len(values)-1)*percent))]


def length_bands(names,fits):
    fits=set(fits)
    result=[]
    for lo,hi in [(1,10),(11,15),(16,20),(21,25),(26,35),(36,999)]:
        members=[name for name in names if lo<=len(name)<=hi]
        result.append({'length':str(lo)+'-'+str(hi) if hi<999 else '36+',
                       'names':len(members),'readable':sum(name in fits for name in members),
                       'fit_percent':round(100*sum(name in fits for name in members)/len(members),2) if members else None})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE/'results-google.json')
    parser.add_argument('--training', choices=['google','external','mixed'], default='google')
    args = parser.parse_args()
    records = [json.loads(line) for line in (HERE/'corpus.jsonl').read_text().splitlines()]
    records += local_methods()
    preferred = json.loads((HERE/'preferred-names.json').read_text())['examples']
    preferred_names = {row['preferred'].lower() for row in preferred}
    google = [row for row in records if row['source'] == 'googleapis']
    assert google, sorted(set(row['source'] for row in records))
    eligible = (google if args.training=='google' else
                [row for row in records if row['source']!='psibase'] if args.training=='external' else records)
    group = lambda row:row['source']+':'+row.get('split_group',row['service'])
    training_groups = {group(row) for row in eligible
                       if int(hashlib.sha256(group(row).encode()).hexdigest(),16) % 5 != 0}
    training_names = sorted({row['method'] for row in eligible if group(row) in training_groups
                             and row['method'].lower() not in preferred_names})
    training_lower = {lower(name) for name in training_names}
    heldout_google = {row['method'] for row in google if group(row) not in training_groups}
    datasets = {'google_service_holdout':sorted(heldout_google),
                'google_novel_holdout':sorted(x for x in heldout_google if lower(x) not in training_lower)}
    datasets['preferred_descriptive_probes'] = sorted(row['preferred'] for row in preferred)
    for source in sorted({row['source'] for row in records} - {'googleapis'}):
        subset = {row['method'] for row in records if row['source']==source
                  and (args.training=='google' or group(row) not in training_groups)}
        if subset:
            datasets[source] = sorted(subset)
            if args.training!='google':
                novel = sorted(name for name in subset if lower(name) not in training_lower)
                if novel:datasets[source+'_novel'] = novel
    names = sorted(set().union(*map(set,datasets.values()), set(training_names),{row['method'] for row in records},
                              {'requestRecovery','requestrecovery','REQUESTRECOVERY','sx','szziat','cx','czpe',
                               'foo_bar','fooqbar','foobar','getData','getDate','load0','loado','load1','loadl'}))
    cpp = probe(ROOT/'build-method-names/codec-probe-cpp',names)
    rust = probe(ROOT/'build-method-names/rust/release/codec-probe-rust',names)
    cpp_decoded = probe(ROOT/'build-method-names/codec-probe-cpp',sorted({row['decoded'] for row in cpp.values() if not row['panic']}))
    rust_decoded = probe(ROOT/'build-method-names/rust/release/codec-probe-rust',sorted({row['decoded'] for row in rust.values() if not row['panic']}))
    baseline = {}
    for label, subset in datasets.items():
        row = {'names':len(subset),'length_median':percentile(list(map(len,subset)),.5),
               'length_p95':percentile(list(map(len,subset)),.95),
               'cpp_rust_disagreements':sum(cpp[x]['value']!=rust[x]['value'] for x in subset)}
        for language, values in [('cpp',cpp),('rust',rust)]:
            readable = [x for x in subset if not values[x]['hashed'] and not values[x]['panic']]
            wrong = [x for x in readable if values[x]['decoded'] != legacy(x)]
            row[language] = {'hash_fallbacks':sum(values[x]['hashed'] for x in subset),
                             'readable_and_correct_to_legacy_canonical':len(readable)-len(wrong),
                             'wrong_readable':len(wrong),'wrong_examples':[{x:values[x]} for x in wrong[:8]]}
            row[language]['length_bands']=length_bands(subset,[name for name in readable if name not in set(wrong)])
            second = cpp_decoded if language=='cpp' else rust_decoded
            row[language]['id_roundtrip_changes'] = sum(values[x]['value']!=second[values[x]['decoded']]['value']
                                                      for x in subset if not values[x]['panic'])
        baseline[label] = row
    started = time.perf_counter()
    models = [('control_current_table_legacy', CurrentTableControl()),
              ('trained_legacy_char1', CharacterModel(training_names,1,legacy,string.ascii_lowercase)),
              ('trained_char0', CharacterModel(training_names,0)),
              ('trained_char1', CharacterModel(training_names,1)),
              ('trained_char2', CharacterModel(training_names,2)),
              ('trained_bpe256', SubwordModel(training_names,256)),
              ('trained_bpe512', SubwordModel(training_names,512)),
              ('trained_words1024', WordModel(training_names,1024)),
              ('trained_words2048', WordModel(training_names,2048)),
              ('lossy_lookalike_char1', CharacterModel(training_names,1,lookalike)),
              ('lossy_vowelless_char1', CharacterModel(training_names,1,vowels))]
    lookup_models=dict(models)
    models.append(('trained_hybrid_char2_bpe512',HybridModel(lookup_models['trained_char2'],lookup_models['trained_bpe512'])))
    models.append(('trained_hybrid_with_literal',HybridModel(lookup_models['trained_char2'],lookup_models['trained_bpe512'],True)))
    models.append(('trained_hybrid_words2048_literal',HybridModel(lookup_models['trained_char2'],lookup_models['trained_words2048'],True)))
    results = {}
    preferred_results = {row['preferred']:{'current_spelling':row['current'],'candidates':{}} for row in preferred}
    random_names = [''.join(random.Random(i).choices(ALPHABET,k=1+i%32)) for i in range(200)]
    for label, model in models:
        summary = {}
        for dataset, subset in datasets.items():
            fits, lengths, changed, same_id = [], [], 0, {}
            for name in subset:
                value, length = encode(model,name)
                lengths.append(length)
                canonical = model.normalize(name)
                changed += canonical != lower(name)
                if value is not None:
                    assert decode(model,value) == canonical,(label,name,decode(model,value))
                    assert value not in same_id or same_id[value] == canonical
                    same_id[value] = canonical
                    fits.append(name)
            summary[dataset] = {'names':len(subset),'fit_63bit_payload':len(fits),
                                'fit_percent':round(100*len(fits)/len(subset),2),
                                'canonical_changed_from_lowercase':changed,
                                'encoded_bits_median':percentile(lengths,.5),
                                'encoded_bits_p95':percentile(lengths,.95),
                                'fit_length_median':percentile(list(map(len,fits)),.5) if fits else 0,
                                'fit_length_p95':percentile(list(map(len,fits)),.95) if fits else 0}
            summary[dataset]['length_bands']=length_bands(subset,fits)
        for name in random_names:
            value,_ = encode(model,name)
            if value is not None:
                assert decode(model,value)==model.normalize(name)
                assert encode(model,decode(model,value))[0]==value
        results[label]={'model':model.summary(),'datasets':summary,
                        'lossy':label.startswith('lossy_')}
        for name in preferred_results:
            value,bits = encode(model,name)
            preferred_results[name]['candidates'][label] = {'readable':value is not None,'bits':bits,
                'decoded':decode(model,value) if value is not None else None}
    output={'scope':'EXPERIMENT ONLY; no production codec or account IDs changed',
            'training':{'source':args.training,'unique_spellings':len(training_names),
                        'unique_lowercase':len(training_lower),'service_family_groups':len(training_groups),
                        'split':'sha256(version-collapsed service family) modulo5, one group in5 held out',
                        'google_exact_name_overlap_excluded_from_novel_holdout':len(heldout_google)-len(datasets['google_novel_holdout'])},
            'prototype_format':'NEW incompatible 1-bit mode+63-bit arithmetic payload; 32-bit range state; positive frequencies; explicitEOS; lowercase; digits/underscore distinct except labeled lossy candidates',
            'hybrid_format':'NEW incompatible2-bit mode+62-bit payload; char2/BPE512 selector; readable branch only',
            'baseline':baseline,'candidates':results,
            'potential_normalization_equivalences_not_wire_collisions':{'legacy':collisions(records,legacy),
                                        'lookalike':collisions(records,lookalike),
                                        'vowelless':collisions(records,vowels)},
            'actual_current_wire_collisions_in_declared_scopes':{'cpp':wire_collisions(records,cpp),
                                                                 'rust':wire_collisions(records,rust)},
            'known_current_counterexamples':{name:{'cpp':cpp[name],'rust':rust[name]}
                                             for name in ['requestRecovery','requestrecovery','REQUESTRECOVERY',
                                                          'sx','szziat','cx','czpe','foo_bar','fooqbar','foobar']},
            'corpus_sha256':hashlib.sha256((HERE/'corpus.jsonl').read_bytes()).hexdigest(),
            'codec_source_sha256':{path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
                                  for path in ['libraries/psio/include/psio/compress_name.hpp',
                                               'rust/psibase_names/src/constants.rs',
                                               'rust/psibase_names/src/method_number.rs',
                                               'rust/psibase_names/src/method_to_number_converter.rs']},
            'local_record_count':sum(row['source']=='psibase' for row in records),
            'preferred_descriptive_probes':preferred_results,
            'evaluation_seconds':round(time.perf_counter()-started,3)}
    args.output.write_text(json.dumps(output,indent=2)+'\n')
    print('Dataset / baselineCPP correct-readable / trained char1 / char2 / BPE512')
    for dataset,row in baseline.items():
        print(dataset,row['names'],round(100*row['cpp']['readable_and_correct_to_legacy_canonical']/row['names'],2),
              *[results[label]['datasets'][dataset]['fit_percent']
                for label in ['trained_char1','trained_char2','trained_bpe512']])
    print('Potential normalization equivalence groups:',{key:value['groups'] for key,value in output['potential_normalization_equivalences_not_wire_collisions'].items()})
    print('Saved',args.output)


if __name__=='__main__':
    main()
