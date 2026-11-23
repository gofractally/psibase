# The MIT License (MIT)
#
# Copyright (c) 2014 Mark Thomas Nelson
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
#
# This code was derived from code written to illustrate the article:
# Data Compression With Arithmetic Coding
# by Mark Nelson
# published at: https://marknelson.us/posts/2014/10/19/data-compression-with-arithmetic-coding.html
#
# It has been modified by Daniel Larimer for the specific purpose of compressing
# short names and the encoder has been updated to use precomputed tables that change
# based on the prior element and it is no longer general purpose.

from pathlib import Path
import json
import sys
from name_encoder import NameEncoder

# The node tests use the same frozen reference and model as all three ports.
# Account names deliberately continue to use their independent encoder.
_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_ROOT / "experiments/method-names"))
from action_name_model import load_model, encode_name, decode_name
_MODEL = load_model(json.loads((_ROOT / "libraries/psibase/common/share/action-name-model.json").read_text()))

class InvalidName(ValueError):
    def __init__(self, name=None):
        super().__init__("Invalid name" + ("" if name is None else ": " + str(name)))

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

def is_hash_name(value):
    return value >> 62 == 3

def method_to_number(value):
    try:
        return encode_name(_MODEL, value)
    except ValueError as error:
        raise InvalidName(value) from error

def number_to_method(value):
    try:
        return decode_name(_MODEL, value)
    except ValueError as error:
        raise InvalidName(value) from error
