'''psibase's wire types for the node tests.

Bytes and text are PSIO's: the types are declared for PSIO's Python package
(external/psio/python in the pinned checkout), which gives each its PSSZ
(psio.to_pssz) and its I-JSON (psio.from_ijson). psibase adds the two names:
an account and a method are 64-bit numbers on the wire and their names in
text.
'''

import json
from dataclasses import dataclass
from typing import Annotated, Any, Optional

import psio
from psio import u8, u16, u32, u64

import name

@psio.transparent
@dataclass(frozen=True)
class AccountNumber:
    value: u64

    @psio.to_text
    def __str__(self):
        return name.number_to_account(self.value)

    @psio.from_text
    @classmethod
    def parse(cls, text):
        return cls(name.account_to_number(text))

@psio.transparent
@dataclass(frozen=True)
class MethodNumber:
    value: u64

    @psio.to_text
    def __str__(self):
        return psio.number_to_method(self.value)

    @psio.from_text
    @classmethod
    def parse(cls, text):
        return cls(psio.method_to_number(text))

def _account(value):
    return value if isinstance(value, AccountNumber) else AccountNumber.parse(value)

def _bytes(value):
    '''Bytes, given as bytes or as hex text'''
    return bytes.fromhex(value) if isinstance(value, str) else bytes(value)

@dataclass(init=False)
class Action:
    '''
    An action. The arguments are either packed (rawData: bytes or hex) or
    still to be packed with the schema of the service (data: an object keyed
    by parameter name, or the positional list); ChainPackContext packs them.
    '''
    sender: AccountNumber
    service: AccountNumber
    method: MethodNumber
    rawData: bytes

    def __init__(self, sender, service, method, dataOrRaw=None, *, data=None, rawData=None):
        self.sender = _account(sender)
        self.service = _account(service)
        self.method = method if isinstance(method, MethodNumber) else MethodNumber.parse(method)
        if dataOrRaw is not None:
            if data is not None or rawData is not None:
                raise Exception('Multiple values for data')
            if isinstance(dataOrRaw, bytes) or isinstance(dataOrRaw, str) and all(ch in '0123456789ABCDEFabcdef' for ch in dataOrRaw):
                rawData = dataOrRaw
            else:
                data = dataOrRaw
        self.data = data
        self.rawData = _bytes(rawData) if rawData is not None else None

@dataclass(init=False)
class Claim:
    service: AccountNumber
    rawData: bytes

    def __init__(self, service, rawData):
        self.service = _account(service)
        self.rawData = _bytes(rawData)

@psio.record(definition_will_not_change=True)
@dataclass
class Tapos:
    expiration: psio.TimePointSec
    refBlockSuffix: u32
    flags: u16
    refBlockIndex: u8

@dataclass(init=False)
class Transaction:
    tapos: Tapos
    actions: list[Action]
    claims: list[Claim]

    def __init__(self, tapos, actions, claims):
        '''tapos is a Tapos or its JSON object; a claim is a Claim or its JSON object'''
        self.tapos = tapos if isinstance(tapos, Tapos) else psio.from_ijson(Tapos, json.dumps(tapos))
        self.actions = list(actions)
        self.claims = [claim if isinstance(claim, Claim) else Claim(**claim) for claim in claims]

@dataclass
class SignedTransaction:
    # The packed transaction: its id is the SHA-256 of these bytes
    transaction: Annotated[bytes, psio.nested(Transaction, deferred=True)]
    proofs: list[bytes]
    subjectiveData: Optional[list[bytes]] = None

def _wire_text(to_number, to_name):
    '''The text of a name whose wire type is a record of one 64-bit number'''
    return psio.Handler(to_text=lambda wire: to_name(wire['value']),
                        from_text=lambda text: {'value': to_number(text)})

# The custom types of a service schema that are a name in text. Any other
# custom type is read as its wire type.
schema_handlers = {
    'AccountNumber': _wire_text(name.account_to_number, name.number_to_account),
    'MethodNumber': _wire_text(psio.method_to_number, psio.number_to_method),
}

@dataclass
class FunctionType:
    params: Any
    result: Any

class ServiceSchema:
    '''
    The schema of a service, from its I-JSON (GET packages/schema?service=).
    actions maps a method's number to the codecs of its argument list and of
    its result (psio.Schema types: json_to_pssz, from_pssz, ...)
    '''
    def __init__(self, document):
        self.service = document['service']
        self.types = psio.Schema.from_json(json.dumps(document['types']), handlers=schema_handlers)
        node = psio.Schema.meta().type('AnyType')
        def codec(type):
            return self.types.type(node.from_json(json.dumps(type), 'ijson'))
        self.actions = {}
        for (method, function) in document['actions'].items():
            result = function['result']
            self.actions[psio.method_to_number(method)] = FunctionType(
                codec(function['params']), codec(result) if result is not None else None)
