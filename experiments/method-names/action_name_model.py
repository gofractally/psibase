#!/usr/bin/env python3
"""Frozen action-name draft exporter and integer-only reference codec.

Only build_model trains statistical tables. Loaded encoders consume frozen
integer CDFs and Q24 token costs, never floating-point probabilities. The C++,
Rust and JavaScript runtime codecs consume this same frozen format.
"""
from bisect import bisect_right
from collections import OrderedDict
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
import hashlib
import json
import math
import re

import benchmark as codec

FORMAT_VERSION = 'action-name-v1-draft'
ALPHABET = codec.ALPHABET
SYMBOLS = [codec.EOS] + list(ALPHABET)
CONTEXTS = ['^^'] + ['^' + char for char in ALPHABET] + [a + b for a in ALPHABET for b in ALPHABET]
MAX_NAME_LENGTH = 256
PAYLOAD_BITS = 62
PAYLOAD_MASK = (1 << PAYLOAD_BITS) - 1
U64_MAX = (1 << 64) - 1
COST_FRACTION_BITS = 24
HASH_DOMAIN = b'psibase.action_name.v1\0'
NAME_PATTERN = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,255}\Z', re.ASCII)
HASH_PATTERN = re.compile(r'#[0-9a-f]{16}\Z', re.ASCII)

NORMALIZATION = {'alphabet': ALPHABET, 'case': 'ASCII lowercase',
                 'identifier': '[A-Za-z_][A-Za-z0-9_]*', 'max_name_length': MAX_NAME_LENGTH,
                 'digits_and_underscores': 'distinct', 'unicode': 'rejected'}
ARITHMETIC = {'range_bits': 32, 'frequency_total': codec.TOTAL,
              'payload_bits': PAYLOAD_BITS, 'eos': codec.EOS,
              'termination': 'benchmark.py arithmetic emit; left-aligned in 63 bits; drop zero low bit for 62-bit payload'}
MODE_RULES = {'0': 'char2', '1': 'component-word', '2': 'bijective-base37', '3': 'sha256-hash',
              'selection': 'minimum (readable payload bit length, mode index, payload value)',
              'literal_alphabet': ALPHABET}
HASH_RULES = {'algorithm': 'SHA-256', 'domain_hex': HASH_DOMAIN.hex(),
              'input': 'domain bytes followed by canonical ASCII name',
              'digest_bytes': 'first 8 bytes', 'byte_order': 'little',
              'payload': 'low 62 bits', 'tag': 3,
              'literal': '# followed by exactly 16 lowercase hex digits of the full u64; mode must be 3'}
COST_RULE = 'round-half-even(-log2((cdf[i+1]-cdf[i])/32768) * 2^24), precomputed'


def canonical_json(document):
    """Stable ASCII JSON bytes, with sorted keys and no insignificant spaces."""
    return json.dumps(document, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False).encode('ascii')


def _canonical_name(name):
    if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
        raise ValueError('action name must be an ASCII identifier of 1..256 characters')
    return name.lower()


def _u64(value):
    if type(value) is not int or not 0 <= value <= U64_MAX:
        raise ValueError('action name ID must be an unsigned 64-bit integer')
    return value


def _costs(cdf):
    """Exporter-only high-precision calculation; loaded codecs use its integers."""
    with localcontext() as context:
        context.prec = 80
        log_two = Decimal(2).ln()
        scale = Decimal(1 << COST_FRACTION_BITS)
        return [int(((Decimal(codec.TOTAL) / Decimal(right - left)).ln()
                     / log_two * scale).to_integral_value(rounding=ROUND_HALF_EVEN))
                for left, right in zip(cdf, cdf[1:])]


def build_model(weights):
    """Train and export all reachable contexts plus a <=2048-token dictionary.

    Input spellings retain CamelCase/snake_case component boundaries for
    dictionary training; their canonical action identity is ASCII lowercase.
    Every spelling needs a finite, strictly positive statistical vote.
    """
    if not isinstance(weights, dict) or not weights:
        raise ValueError('training weights must be a nonempty dictionary')
    numeric_weights = []
    for name, weight in weights.items():
        _canonical_name(name)
        if type(weight) not in (int, float):
            raise ValueError('every training weight must be finite and positive')
        try:
            numeric = float(weight)
        except (OverflowError, ValueError) as error:
            raise ValueError('every training weight must be finite and positive') from error
        if not math.isfinite(numeric) or numeric <= 0:
            raise ValueError('every training weight must be finite and positive')
        numeric_weights.append(numeric)
    try:
        total_weight = math.fsum(numeric_weights)
    except OverflowError as error:
        raise ValueError('total training weight must be finite') from error
    if not math.isfinite(total_weight):
        raise ValueError('total training weight must be finite')
    names = sorted(weights)
    char = codec.CharacterModel(names, 2, weights=weights)
    words = codec.WordModel(names, 2048, weights=weights)
    document = {
        'format_version': FORMAT_VERSION,
        'normalization': dict(NORMALIZATION), 'arithmetic': dict(ARITHMETIC),
        'modes': dict(MODE_RULES), 'hash': dict(HASH_RULES),
        'character': {'order': 2, 'symbols': list(SYMBOLS), 'contexts': list(CONTEXTS),
                      'cdf_rows': [list(char.distribution(context)) for context in CONTEXTS]},
        'word': {'vocabulary_limit': 2048, 'symbols': list(words.symbols),
                 'cdf': list(words.cdf), 'cost_fraction_bits': COST_FRACTION_BITS,
                 'cost_rule': COST_RULE, 'token_costs': _costs(words.cdf),
                 'segmentation_tie': ['total_integer_cost', 'token_count', 'token_id_tuple']},
    }
    load_model(document)
    return document


def _cdf(value, symbols):
    if (not isinstance(value, list) or len(value) != len(symbols) + 1
            or any(type(number) is not int for number in value)
            or value[0] != 0 or value[-1] != codec.TOTAL
            or any(left >= right for left, right in zip(value, value[1:]))):
        raise ValueError('CDF must contain strictly positive integer frequencies totaling 32768')
    return tuple(value)


class FrozenCharacterModel:
    normalize = staticmethod(_canonical_name)
    order = 2

    def __init__(self, rows):
        self.symbols = tuple(SYMBOLS)
        self.indices = {symbol: index for index, symbol in enumerate(self.symbols)}
        self.rows = dict(zip(CONTEXTS, rows))

    def tokenize(self, name):
        return list(_canonical_name(name))

    def distribution(self, context):
        return self.rows[('^^' + context)[-2:]]

    def next_context(self, context, token):
        return (context + token)[-2:]

    def summary(self):
        return {'kind': 'frozen_char2', 'context_rows': len(self.rows),
                'symbols_including_eos': len(self.symbols),
                'cdf_u16_bytes': sum(len(row) * 2 for row in self.rows.values())}


class FrozenWordModel:
    normalize = staticmethod(_canonical_name)

    def __init__(self, symbols, cdf, costs):
        self.symbols = tuple(symbols)
        self.indices = {symbol: index for index, symbol in enumerate(self.symbols)}
        self.cdf, self.costs = cdf, tuple(costs)
        self.trie, self.cache = {}, OrderedDict()
        for index, word in enumerate(symbols[1:], 1):
            node = self.trie
            for char in word:
                node = node.setdefault(char, {})
            node[None] = index

    def tokenize(self, name):
        name = _canonical_name(name)
        if name in self.cache:
            tokens = self.cache[name]
            self.cache.move_to_end(name)
            return [self.symbols[index] for index in tokens]
        paths = [None] * (len(name) + 1)
        paths[0] = (0, 0, ())
        for begin in range(len(name)):
            previous = paths[begin]
            if previous is None:
                continue
            node = self.trie
            for end in range(begin, len(name)):
                node = node.get(name[end])
                if node is None:
                    break
                index = node.get(None)
                if index is not None:
                    proposal = (previous[0] + self.costs[index], previous[1] + 1,
                                previous[2] + (index,))
                    if paths[end + 1] is None or proposal < paths[end + 1]:
                        paths[end + 1] = proposal
        if paths[-1] is None:
            raise ValueError('dictionary cannot represent canonical name')
        tokens = paths[-1][2]
        self.cache[name] = tokens
        if len(self.cache) > 4096:
            self.cache.popitem(last=False)
        return [self.symbols[index] for index in tokens]

    def distribution(self, context):
        return self.cdf

    def next_context(self, context, token):
        return ''

    def summary(self):
        return {'kind': 'frozen_component_dictionary_q24',
                'symbols_including_eos': len(self.symbols),
                'dictionary_utf8_bytes': sum(len(word) for word in self.symbols),
                'cdf_u16_bytes': len(self.cdf) * 2, 'token_cost_u32_bytes': len(self.costs) * 4}


def _decode_arithmetic(model, value):
    """The reference arithmetic decoder with a 256-character output bound."""
    position = 0

    def take():
        nonlocal position
        bit = (value >> (62 - position)) & 1 if position < 63 else 0
        position += 1
        return bit

    low, high, context, code, out, length = 0, codec.MAX, '', 0, [], 0
    for _ in range(32):
        code = (code << 1) | take()
    for _ in range(MAX_NAME_LENGTH + 1):
        cdf = model.distribution(context)
        width = high - low + 1
        scaled = ((code - low + 1) * codec.TOTAL - 1) // width
        index = bisect_right(cdf, scaled) - 1
        if not 0 <= index < len(model.symbols):
            raise ValueError('arithmetic code lies outside its CDF')
        token = model.symbols[index]
        if token == codec.EOS:
            return ''.join(out)
        length += len(token)
        if length > MAX_NAME_LENGTH:
            raise ValueError('decoded action name exceeds 256 characters')
        out.append(token)
        high, low = (low + width * cdf[index + 1] // codec.TOTAL - 1,
                     low + width * cdf[index] // codec.TOTAL)
        while True:
            if high < codec.HALF:
                pass
            elif low >= codec.HALF:
                code -= codec.HALF
                low -= codec.HALF
                high -= codec.HALF
            elif low >= codec.QUARTER and high < codec.THREE_QUARTERS:
                code -= codec.QUARTER
                low -= codec.QUARTER
                high -= codec.QUARTER
            else:
                break
            low <<= 1
            high = (high << 1) | 1
            code = (code << 1) | take()
        context = model.next_context(context, token)
    raise ValueError('decoded action name has no bounded EOS')


class FrozenReadableModel(codec.HybridModel):
    """Benchmark-compatible readable branch with exact canonical ID validation."""
    normalize = staticmethod(_canonical_name)

    def encode(self, name):
        name = _canonical_name(name)
        options, lengths = [], []
        for mode, model in enumerate(self.models):
            value, length = codec.encode(model, name)
            lengths.append(length)
            if value is not None and length <= PAYLOAD_BITS:
                options.append((length, mode, value >> 1))
        literal = 0
        for char in name:
            literal = literal * len(ALPHABET) + ALPHABET.index(char) + 1
        if 0 < literal <= PAYLOAD_MASK:
            options.append((literal.bit_length(), 2, literal))
        if not options:
            return None, min(lengths)
        length, mode, payload = min(options)
        return (mode << PAYLOAD_BITS) | payload, length

    def decode(self, value):
        value = _u64(value)
        mode, payload = value >> PAYLOAD_BITS, value & PAYLOAD_MASK
        if mode == 2:
            chars = []
            while payload:
                payload, index = divmod(payload - 1, len(ALPHABET))
                chars.append(ALPHABET[index])
            name = ''.join(reversed(chars))
        elif mode in (0, 1):
            name = _decode_arithmetic(self.models[mode], payload << 1)
        else:
            raise ValueError('hash ID has no readable spelling')
        canonical = _canonical_name(name)
        if canonical != name or self.encode(canonical)[0] != value:
            raise ValueError('noncanonical readable action-name ID')
        return canonical

    def summary(self):
        return {'kind': 'frozen_readable_mixture', 'tag_bits': 2,
                'payload_bits': PAYLOAD_BITS, 'modes': ['char2', 'component-word', 'bijective-base37']}


class ActionNameModel:
    def __init__(self, document, char, words):
        self.format_version = FORMAT_VERSION
        self.model_sha256 = hashlib.sha256(canonical_json(document)).hexdigest()
        self.readable = FrozenReadableModel(char, words, literal=True)


def load_model(document):
    """Validate a frozen JSON model once and return reusable integer-only state."""
    if not isinstance(document, dict) or document.get('format_version') != FORMAT_VERSION:
        raise ValueError('unsupported action-name format')
    for key, expected in [('normalization', NORMALIZATION), ('arithmetic', ARITHMETIC),
                          ('modes', MODE_RULES), ('hash', HASH_RULES)]:
        if document.get(key) != expected:
            raise ValueError('unsupported frozen format rule: ' + key)
    char, word = document.get('character'), document.get('word')
    if not isinstance(char, dict) or char.get('order') != 2 or char.get('symbols') != SYMBOLS or char.get('contexts') != CONTEXTS:
        raise ValueError('invalid frozen character context layout')
    rows = char.get('cdf_rows')
    if not isinstance(rows, list) or len(rows) != len(CONTEXTS):
        raise ValueError('all 1407 character contexts are required')
    rows = [_cdf(row, SYMBOLS) for row in rows]
    if not isinstance(word, dict) or word.get('vocabulary_limit') != 2048:
        raise ValueError('invalid word vocabulary contract')
    symbols = word.get('symbols')
    if (not isinstance(symbols, list) or not len(SYMBOLS) <= len(symbols) <= 2048
            or symbols[:len(SYMBOLS)] != SYMBOLS
            or any(not isinstance(token, str) for token in symbols)
            or len(set(symbols)) != len(symbols)
            or any(not 2 <= len(token) <= MAX_NAME_LENGTH or not set(token) <= set(ALPHABET)
                   for token in symbols[len(SYMBOLS):])):
        raise ValueError('invalid word dictionary')
    if (word.get('cost_fraction_bits') != COST_FRACTION_BITS or word.get('cost_rule') != COST_RULE
            or word.get('segmentation_tie') != ['total_integer_cost', 'token_count', 'token_id_tuple']):
        raise ValueError('unsupported integer word segmentation rule')
    cdf = _cdf(word.get('cdf'), symbols)
    costs = word.get('token_costs')
    if (not isinstance(costs, list) or len(costs) != len(symbols)
            or any(type(cost) is not int or not 0 < cost <= 15 << COST_FRACTION_BITS for cost in costs)):
        raise ValueError('invalid frozen integer token costs')
    return ActionNameModel(document, FrozenCharacterModel(rows), FrozenWordModel(symbols, cdf, costs))


def _loaded(document_or_model):
    if isinstance(document_or_model, ActionNameModel):
        return document_or_model
    return load_model(document_or_model)


def encode_name(document_or_model, name):
    """Encode canonical ASCII name or exact hash literal into an unsigned u64."""
    model = _loaded(document_or_model)
    if isinstance(name, str) and name.startswith('#'):
        if not HASH_PATTERN.fullmatch(name):
            raise ValueError('hash literal must be # followed by 16 lowercase hex digits')
        value = int(name[1:], 16)
        if value >> PAYLOAD_BITS != 3:
            raise ValueError('explicit hash literal must have hash-mode tag 3')
        return value
    canonical = _canonical_name(name)
    value, _ = codec.encode(model.readable, canonical)
    if value is not None:
        return value
    digest = hashlib.sha256(HASH_DOMAIN + canonical.encode('ascii')).digest()
    payload = int.from_bytes(digest[:8], 'little') & PAYLOAD_MASK
    return (3 << PAYLOAD_BITS) | payload


def decode_name(document_or_model, value):
    """Decode a canonical readable ID or an exact full-u64 hash literal."""
    model, value = _loaded(document_or_model), _u64(value)
    if value >> PAYLOAD_BITS == 3:
        return '#' + format(value, '016x')
    return codec.decode(model.readable, value)
