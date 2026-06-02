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

from name_encoder import NameEncoder

code_digits = 32
code_value_bits = (code_digits + 3) // 2
FREQUENCY_BITS = code_digits - code_value_bits

PRECISION = code_digits
MAX_CODE  = (1 << code_value_bits) - 1
ONE_FOURTH = 1 << (code_value_bits - 2)
ONE_HALF      = 2 * ONE_FOURTH
THREE_FOURTHS = 3 * ONE_FOURTH;

method_symbol_to_char = ['\0',   'e', 'a', 'i', 'o', 't', 'n', 'r', 's',
                         'l', 'c', 'u', 'h', 'd', 'p', 'm', 'y', 'g',
                         'b', 'f', 'w', 'v', 'k', 'z', 'x', 'q', 'j'];

method_model_cf = [
    [0,     0,     1956,  4146,  6063,  7423,  9305,  10276, 11226, 13687,
     14907, 16131, 17056, 18369, 19922, 21644, 23210, 24604, 25065, 26398,
     28475, 30408, 31395, 31725, 32367, 32402, 32623, 32767],
    [0,     4880,  5243,  6669,  7714,  8472,  9634,  11619, 15233, 16738,
     18031, 18650, 18993, 20913, 22653, 25217, 25802, 26404, 26589, 28244,
     29312, 31398, 31845, 32080, 32183, 32478, 32695, 32767],
    [0,     1737,  2901,  3020,  3666,  3734,  8543,  12634, 15523, 17208,
     21367, 22949, 23407, 24602, 25562, 26470, 28001, 28323, 29045, 30727,
     31040, 31251, 32084, 32387, 32496, 32598, 32745, 32767],
    [0,     1420,  3454,  4922,  5132,  6751,  9959,  13993, 14547, 18653,
     20482, 23055, 23598, 23956, 25067, 25566, 27966, 27973, 28483, 29334,
     29844, 30620, 31685, 31882, 32375, 32425, 32757, 32767],
    [0,     4209,  5209,  5503,  5994,  6779,  9809,  13734, 16394, 17728,
     20734, 21636, 23733, 24071, 24785, 26194, 28482, 28566, 29403, 30186,
     30894, 31383, 32100, 32294, 32382, 32531, 32744, 32767],
    [0,     6157,  9213,  10380, 13294, 15931, 16600, 16829, 17987, 18142,
     18574, 18667, 19055, 21787, 22406, 24449, 24772, 25604, 25663, 29173,
     30781, 31791, 31995, 32219, 32350, 32610, 32748, 32767],
    [0,     4891,  8913,  10772, 13035, 15218, 19118, 19893, 20080, 21202,
     22114, 23568, 23895, 24392, 26546, 26760, 27744, 28021, 30534, 31037,
     31376, 31650, 32250, 32490, 32548, 32565, 32709, 32767],
    [0,     4689,  9532,  12839, 16144, 19335, 21427, 21880, 22583, 23728,
     24811, 25404, 25957, 26777, 27443, 28035, 29213, 30179, 30481, 31447,
     31666, 31782, 32303, 32484, 32510, 32511, 32751, 32767],
    [0,     5750,  9495,  10402, 12127, 13082, 19468, 19684, 19710, 21681,
     23775, 24600, 25576, 26982, 27084, 27953, 30214, 30492, 30515, 30947,
     31019, 31446, 31709, 31847, 31884, 31884, 32761, 32767],
    [0,     1827,  5418,  7243,  11598, 13806, 14484, 14972, 15432, 15532,
     16785, 16863, 17441, 18465, 19298, 23066, 24626, 26449, 26523, 27067,
     29601, 31460, 31683, 32257, 32266, 32312, 32318, 32767],
    [0,     3085,  6902,  11386, 13498, 18692, 21202, 21246, 22818, 22950,
     23980, 24484, 25962, 30168, 30176, 30181, 30391, 31287, 31288, 31293,
     31294, 31297, 31592, 32703, 32712, 32712, 32767, 32767],
    [0,     1460,  2488,  3382,  4190,  4382,  7997,  13589, 16710, 21209,
     25118, 26178, 26204, 26432, 27181, 28387, 30216, 30257, 30864, 31867,
     32177, 32219, 32374, 32455, 32551, 32617, 32754, 32767],
    [0,     3497,  9469,  11581, 13649, 15750, 19606, 19858, 20362, 20409,
     23728, 23738, 24110, 26020, 26170, 26284, 28241, 29240, 29247, 29296,
     29442, 29819, 30442, 30559, 30604, 30604, 32763, 32767],
    [0,     7725,  13656, 15552, 18212, 19436, 22322, 22566, 23251, 23443,
     26247, 26267, 26704, 26809, 27460, 27622, 29567, 30839, 30969, 31225,
     31379, 31448, 32114, 32127, 32143, 32143, 32739, 32767],
    [0,     3654,  6677,  7904,  9941,  12843, 16232, 16550, 19915, 20300,
     22842, 22898, 23406, 25127, 25246, 25931, 27743, 28101, 28153, 28321,
     29252, 31975, 32243, 32396, 32480, 32494, 32721, 32767],
    [0,     2259,  4242,  6358,  8676,  10453, 10663, 11361, 12343, 12503,
     13022, 13049, 13568, 15061, 16673, 21204, 22114, 23775, 23801, 26743,
     28089, 29382, 31518, 31992, 32482, 32634, 32711, 32767],
    [0,     8569,  10926, 11269, 11458, 12219, 15419, 15811, 16168, 19632,
     21864, 22233, 22272, 23584, 23897, 24563, 27086, 27677, 27838, 30347,
     30897, 31720, 32305, 32316, 32374, 32410, 32766, 32767],
    [0,     5421,  10228, 13261, 16435, 18453, 18538, 19596, 22477, 22749,
     25180, 25189, 26615, 28325, 28370, 28391, 28704, 29610, 30232, 30341,
     30376, 30446, 32750, 32760, 32764, 32764, 32765, 32767],
    [0,     3536,  8233,  9248,  10667, 11916, 16198, 16366, 17262, 17620,
     22341, 22384, 23103, 23432, 24178, 24653, 27955, 28446, 28462, 29156,
     29914, 30860, 31440, 31618, 31718, 31718, 32711, 32767],
    [0,     6957,  8777,  9282,  11114, 12083, 14679, 14746, 15172, 16789,
     19423, 19431, 20076, 20456, 21353, 21603, 22831, 23934, 24047, 24077,
     26986, 30996, 32258, 32271, 32421, 32421, 32764, 32767],
    [0,     4391,  7270,  8148,  9018,  9499,  14426, 14654, 14752, 18571,
     23671, 23681, 23696, 24591, 24714, 24801, 27775, 27825, 27830, 30016,
     30215, 30862, 31659, 31682, 31823, 31824, 32740, 32767],
    [0,     508,   5145,  6952,  9251,  10376, 10985, 11140, 11725, 11743,
     12502, 12513, 12662, 15602, 17187, 22455, 22627, 23556, 23562, 26519,
     30666, 32564, 32574, 32641, 32646, 32708, 32730, 32767],
    [0,     2561,  9484,  10526, 12712, 13144, 24077, 24752, 24913, 25311,
     29557, 29584, 29814, 30171, 30199, 30250, 31654, 31986, 32003, 32134,
     32255, 32412, 32625, 32686, 32687, 32687, 32751, 32767],
    [0,     1902,  10556, 12815, 13501, 14918, 18520, 18600, 18633, 21631,
     26209, 26218, 26391, 26794, 26889, 27833, 30807, 31246, 31254, 31774,
     32060, 32183, 32247, 32252, 32655, 32655, 32756, 32767],
    [0,     3478,  6497,  8308,  12600, 13818, 17038, 17122, 17152, 17528,
     20748, 21906, 22255, 22599, 22677, 24481, 25735, 28777, 28815, 28891,
     29073, 31075, 31424, 31433, 31485, 31485, 32764, 32767],
    [0,     17596, 18281, 18455, 19256, 19875, 20521, 20599, 20949, 21038,
     21413, 21416, 23479, 24932, 25804, 26610, 28270, 29555, 29557, 30312,
     31584, 32451, 32516, 32525, 32623, 32701, 32703, 32767],
    [0,     392,   8308,  10995, 11504, 13348, 22180, 22194, 22231, 22248,
     23981, 23981, 26646, 26978, 27000, 27014, 30409, 30435, 30435, 30457,
     30474, 30503, 30697, 30704, 30818, 30818, 31861, 32767]]

class Prob:
    def __init__(self, low, high, count):
        self.low = low
        self.high = high
        self.count = count

class Model:
    def __init__(self, symbols, model_cf):
        self.m_last_byte = 0
        self.symbol_to_char = symbols
        self.model_cf = model_cf

        self.char_to_symbol = [0] * 256
        self.model_width   = len(symbols)

        for (i, ch) in enumerate(self.symbol_to_char):
            self.char_to_symbol[ord(ch)] = i

    def getProbability(self, c):
        cumulative_frequency = self.model_cf[self.m_last_byte];
        self.m_last_byte = c
        return Prob(cumulative_frequency[c], cumulative_frequency[c + 1],
                    cumulative_frequency[self.model_width])

    def getChar(self, scaled_value):
        cumulative_frequency = self.model_cf[self.m_last_byte]

        for i in range(self.model_width):
            if scaled_value < cumulative_frequency[i + 1]:
                c      = i
                p = Prob(cumulative_frequency[i], cumulative_frequency[i + 1],
                         cumulative_frequency[self.model_width])
                if p.count == 0:
                    c = char_to_symbol[0]
                    self.m_last_byte = c
                    return (Prob(0, 1, 1), c)
                self.m_last_byte = c
                return (p, c)
        return (Prob(0, 1, 1), char_to_symbol[0])

    def getCount(self):
        return self.model_cf[self.m_last_byte][self.model_width];

    def compress(self, input, out=None):
        for i in input:
            if self.char_to_symbol[ord(i)] == 0:
                raise InvalidName(input)
        if out is None:
            out = BitStream()

        def getBytes():
            for ch in input:
                yield self.char_to_symbol[ord(ch)]
            yield 0

        low          = 0
        high         = MAX_CODE

        for c in getBytes():
            if out.done():
                return out.too_long()

            p     = self.getProbability(c)
            range = high - low + 1

            if p.count == 0:
                return 0  # logic error shouldn't happen

            high = low + (range * p.high // p.count) - 1;
            low  = low + (range * p.low // p.count);

            # On each pass there are six possible configurations of high/low,
            # each of which has its own set of actions. When high or low
            # is converging, we output their MSB and upshift high and low.
            # When they are in a near-convergent state, we upshift over the
            # next-to-MSB, increment the pending count, leave the MSB intact,
            # and don't output anything. If we are not converging, we do
            # no shifting and no output.
            # high: 0xxx, low anything : converging (output 0)
            # low: 1xxx, high anything : converging (output 1)
            # high: 10xxx, low: 01xxx : near converging
            # high: 11xxx, low: 01xxx : not converging
            # high: 11xxx, low: 00xxx : not converging
            # high: 10xxx, low: 00xxx : not converging
            while not out.done():
                if high < ONE_HALF:
                    out.put_bit_plus_pending(0)
                elif low >= ONE_HALF:
                    out.put_bit_plus_pending(1)
                elif low >= ONE_FOURTH and high < THREE_FOURTHS:
                    out.pending_bits += 1
                    low -= ONE_FOURTH
                    high -= ONE_FOURTH
                else:
                    break
                high <<= 1
                high += 1
                low <<= 1
                high &= MAX_CODE
                low &= MAX_CODE

        out.pending_bits += 1;

        if low < ONE_FOURTH:
            out.put_bit_plus_pending(0);
        else:
            out.put_bit_plus_pending(1);

        return out

    def uncompress(self, input):
        if input == 0:
            return ""

        stream = BitInputStream(input)
        out = ""

        high  = MAX_CODE;
        low   = 0;
        value = 0;
        for i in range(code_value_bits):
            value <<= 1
            value += stream.get_bit()
        while not stream.done():
            range_ = high - low + 1;

            if range_ == 0:
                raise Exception("RUNTIME LOGIC ERROR")

            scaled_value = ((value - low + 1) * self.getCount() - 1) // range_;
            (p, c) = self.getChar(scaled_value);
            if c == 0:
                break

            out += self.symbol_to_char[c]

            if p.count == 0:
                raise Exception("RUNTIME LOGIC ERROR")

            high = low + (range_ * p.high) // p.count - 1;
            low  = low + (range_ * p.low) // p.count;

            while not stream.done():
                if high < ONE_HALF:
                    # do nothing, bit is a zero
                    pass
                elif low >= ONE_HALF:
                    value -= ONE_HALF  # subtract one half from all three code values
                    low -= ONE_HALF
                    high -= ONE_HALF
                elif low >= ONE_FOURTH and high < THREE_FOURTHS:
                    value -= ONE_FOURTH
                    low -= ONE_FOURTH
                    high -= ONE_FOURTH
                else:
                    break
                low <<= 1
                high <<= 1
                high += 1
                value <<= 1
                value += stream.get_bit()

        return out

class BitStream:
    def __init__(self):
        self.m_bit      = 0
        self.m_NextByte = 0
        self.m_Mask     = 0x80
        self.m_output   = 0
        self.pending_bits = 0
    def put_bit(self, b):
        if (b):
            self.m_NextByte |= self.m_Mask;
        self.m_Mask >>= 1
        if self.m_Mask == 0:
            if self.m_bit < 64:
               self.m_output |= (self.m_NextByte << self.m_bit)

            self.m_bit += 8

            self.m_Mask = 0x80
            self.m_NextByte = 0

    def put_bit_plus_pending(self, bit):
        self.put_bit(bit)
        for i in range(self.pending_bits):
            self.put_bit(bit ^ 1)
        self.pending_bits = 0

    def finish(self):
        if self.m_Mask != 0x80:
            if not self.done():
                self.m_output |= (self.m_NextByte << self.m_bit)
            else:
                self.m_output = 0
        return self.m_output

    def too_long(self):
        raise InvalidName()

    def done(self):
        return self.m_bit >= 64

def seahash(input):
    input = input.encode()
    def h(x):
        return x ^ ((x >> 32) >> (x >> 60))
    def j(x):
        p = 0x6eed0e9da4d94a4f
        return (p*x) & ((1 << 64) - 1)
    def g(x):
        return j(h(j(x)))
    a = 0x16f11fe89b0d677c
    b = 0xb480a793d8e6c86c
    c = 0x6fe2e5aaf078ebc9
    d = 0x14f994a4c5259381
    for i in range(0, len(input), 8):
        n = int.from_bytes(input[i:i+8], 'little')
        (a, b, c, d) = (b, c, d, g(a ^ n))
    return g(a ^ b ^ c ^ d ^ len(input))

def city64_seed(s, seed):
    global city64_seed
    from cityhash import CityHash64WithSeed as city64_seed
    return city64_seed(s, seed)

class MethodBitStream(BitStream):
    def too_long(self):
        return self
    def finish(self, input):
        if not self.done():
            result = super().finish()
            if result != 0:
                return result
        return seahash(input) | (1 << 56)

class BitInputStream:
    def __init__(self, input):
        self.input = input
        self.current_byte = 0;
        self.last_mask    = 1;
        self.not_eof = 64 + 16;  # allow extra bits to be brought in as helps improve accuracy
    def get_bit(self):
        if self.last_mask == 1:
            self.current_byte = self.input & 0xff
            self.input >>= 8
            self.last_mask = 0x80
        else:
            self.last_mask >>= 1
            self.not_eof -= 1
        return 1 if (self.current_byte & self.last_mask) != 0 else 0

    def done(self):
        return self.not_eof == 0

class InvalidName(Exception):
    def __init__(self, name=None):
        super().__init__("Invalid name" + (name if name is None else ": " + name))

ACCOUNT_ENCODER = NameEncoder(10, 36)
CHARS = "-0123456789abcdefghijklmnopqrstuvwxyz"
SUBACCOUNT_SEPARATOR = "☺"

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

def is_hash_name(h):
    return (h & (0x01 << (64 - 8))) > 0

def method_to_number(input):
    input = input.replace('_', '')
    if len(input) == 0:
        return 0;

    model = Model(method_symbol_to_char, method_model_cf)

    if input[0] == '#':
        input = input.lower()
        if len(input) != 17:
            raise InvalidName()

        output = 0
        for i in range(1, 17):
            sym = model.char_to_symbol[ord(input[i])] - 1
            sym <<= 4 * (i - 1);
            output |= sym
        return output

    # TODO: handle hash name
    return model.compress(input.lower(), MethodBitStream()).finish(input)

def number_to_method(input):
    model = Model(method_symbol_to_char, method_model_cf)
    #if (input & (uint64_t(0x01) << (64 - 8)))
    if is_hash_name(input):
        s = "#";
        # then it is a hash
        r = input;
        for i in range(16):
            s += model.symbol_to_char[(r & 0x0f) + 1]
            r >>= 4
        return s

    return model.uncompress(input)
