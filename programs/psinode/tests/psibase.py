import name
import fracpack
from fracpack import FracPack, Hex, Int, List, Object, Struct, u8, u16, u32

import calendar
import time

class AccountNumber(Int):
    def __init__(self, ty=None):
        super().__init__(64, False)
    def pack(self, value, stream):
        super().pack(name.account_to_number(value), stream)

class MethodNumber(Int):
    def __init__(self, ty=None):
        super().__init__(64, False)
    def pack(self, value, stream):
        super().pack(name.method_to_number(value), stream)

class TimePointSec(Int):
    def __init__(self, ty=None):
        super().__init__(32, False)
    def pack(self, value, stream):
        if isinstance(value, str):
            value = calendar.timegm(time.strptime(value, "%Y-%m-%dT%H:%M:%SZ"))
        super().pack(value, stream)

default_custom = fracpack.default_custom | {
    "AccountNumber": AccountNumber,
    "MethodNumber": MethodNumber,
    "TimePointSec": TimePointSec,
}

AccountNumber = AccountNumber()
MethodNumber = MethodNumber()
TimePointSec = TimePointSec()

Action = Object([('sender', AccountNumber), ('service', AccountNumber), ('method', MethodNumber), ('rawData', Hex(List(u8)))])

Tapos = Struct([('expiration',TimePointSec),('refBlockSuffix',u32),('flags',u16),('refBlockIndex',u8)])

Claim = Object([('service', AccountNumber), ('rawData', Hex(List(u8)))])

Transaction = Object([('tapos', Tapos), ('actions', List(Action)), ('claims', List(Claim))])

SignedTransaction = Object([('transaction', Hex(FracPack(Transaction))), ('proofs', List(Hex(List(u8))))])
