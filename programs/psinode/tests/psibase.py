import name
import fracpack
from fracpack import *

import calendar
import time

class AccountNumber(u64):
    def pack(self, value, stream):
        super().pack(name.account_to_number(value), stream)

class MethodNumber(u64):
    def pack(self, value, stream):
        super().pack(name.method_to_number(value), stream)

class TimePointSec(u32):
    def pack(self, value, stream):
        if isinstance(value, str):
            value = calendar.timegm(time.strptime(value, "%Y-%m-%dT%H:%M:%SZ"))
        super().pack(value, stream)

default_custom = fracpack.default_custom | {
    "AccountNumber": AccountNumber,
    "MethodNumber": MethodNumber,
    "TimePointSec": TimePointSec,
}

class Action(Object):
    sender: AccountNumber
    service: AccountNumber
    method: MethodNumber
    rawData: Bytes

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
