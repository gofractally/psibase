# psibase's account names: text <-> the 64-bit number.
#
# Method names are PSIO's: psio.method_to_number, psio.number_to_method,
# psio.is_hash_name (PSIO's Python package).

from name_encoder import NameEncoder

class InvalidName(Exception):
    def __init__(self, name=None):
        super().__init__("Invalid name" + (name if name is None else ": " + name))

ACCOUNT_ENCODER = NameEncoder(10, 36)
CHARS = "-0123456789abcdefghijklmnopqrstuvwxyz"
SUBACCOUNT_SEPARATOR = "+"

def account_to_number(s):
    parts = s.split(SUBACCOUNT_SEPARATOR, 1)
    if len(parts) == 1:
        sub = 0
    else:
        s = parts[0]
        sub = int(parts[1])
    result = ACCOUNT_ENCODER.encode((CHARS.find(ch) for ch in s), 0)
    if result == -1:
        raise InvalidName(s)
    return (result << 8) + sub

def number_to_account(n):
    if n & 0xff:
        sub = SUBACCOUNT_SEPARATOR + str(n & 0xff)
    else:
        sub = ""
    return "".join(CHARS[idx] for idx in ACCOUNT_ENCODER.decode(n >> 8, 0)) + sub
