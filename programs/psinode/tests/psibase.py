import name
import fracpack
from fracpack import *

import calendar
import time

class AccountNumber(u64):
    @staticmethod
    def pack(value, stream):
        u64.pack(name.account_to_number(value), stream)

class MethodNumber(u64):
    @staticmethod
    def pack(value, stream):
        u64.pack(name.method_to_number(value), stream)

class TimePointSec(u32):
    @staticmethod
    def pack(value, stream):
        if isinstance(value, str):
            value = calendar.timegm(time.strptime(value, "%Y-%m-%dT%H:%M:%SZ"))
        u32.pack(value, stream)

class RawAction(Object):
    sender: AccountNumber
    service: AccountNumber
    method: MethodNumber
    rawData: Bytes

class Action(Custom(RawAction, "Action"), ObjectValue):
    def __init__(self, sender, service, method, dataOrRaw=None, *, data=None, rawData=None):
        self.sender = sender
        self.service = service
        self.method = method
        self.data = data
        if rawData is not None:
            self.rawData = rawData
        if dataOrRaw is not None:
            if data is not None or rawData is not None:
                raise Exception('Multiple values for data')
            if isinstance(dataOrRaw, bytes) or isinstance(dataOrRaw, str) and all(ch in '0123456789ABCDEFabcdef' for ch in dataOrRaw):
                self.rawData = dataOrRaw
            else:
                self.data = dataOrRaw
    @staticmethod
    def with_context(context):
        class Action(RawAction, ObjectValue):
            @staticmethod
            def pack(value, stream):
                if isinstance(value, ObjectValue):
                    value = value.__dict__
                service = value['service']
                method = value['method']
                if 'rawData' in value:
                    rawData = value['rawData']
                elif 'data' in value:
                    rawData = context.pack_action_data(service, method, value['data'])
                RawAction.pack({'sender': value['sender'], 'service': service, 'method': method, 'rawData':rawData}, stream)
        return Action

default_custom = fracpack.default_custom | {
    "AccountNumber": AccountNumber,
    "MethodNumber": MethodNumber,
    "TimePointSec": TimePointSec,
}

class ServiceSchema:
    def __init__(self, json, custom=None, api=None):
        if custom is None:
            custom = default_custom
        if api is not None:
            custom = custom | {"Action": ActionEx2}
        self.service = json['service']
        self.types = Schema(json.get('types', {}), custom=custom)
        self.actions = {}
        for (name, ty) in json.get('actions', {}):
            params = load_type(ty['params'], self.types)
            result = ty.get('result')
            if result is not None:
                result = load_type(result, self.types)
            self.actions[name] = FunctionType(params, result)
        def get_events(name):
            events = {}
            for (name, ty) in json.get(name, {}):
                events[name] = load_type(result, self.types)
            return events
        self.ui = get_events('ui')
        self.history = get_events('history')
        self.merkle = get_events('merkle')

class Tapos(Struct):
    expiration: TimePointSec
    refBlockSuffix: u32
    flags: u16
    refBlockIndex: u8

class Claim(Object):
    service: AccountNumber
    rawData: Bytes

class Transaction(Object):
    tapos: Tapos
    actions: List(Action)
    claims: List(Claim)

class SignedTransaction(Object):
    transaction: Hex(FracPack(Transaction))
    proofs: List(Bytes)
