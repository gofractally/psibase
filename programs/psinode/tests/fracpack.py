import math
import json
from collections import abc

class OutputStream:
    def __init__(self):
        self.bytes = bytearray()
    def write_bytes(self, data):
        self.bytes.extend(data)
    def write_u8(self, value):
        self.bytes.append(value)
    def write_u16(self, value):
        for i in range(2):
            self.write_u8(value & 0xFF)
            value = value >> 8
    def write_u32(self, value):
        for i in range(4):
            self.write_u8(value & 0xFF)
            value = value >> 8
    def repack_u32(self, pos, value):
        for i in range(4):
            self.bytes[pos] = value & 0xFF
            pos += 1
            value >>= 8
    @property
    def pos(self):
        return len(self.bytes)

class OffsetRepack:
    def __init__(self, stream, value, ty):
        self.pos = stream.pos - 4
        self.stream = stream
        self.value = value
        self.ty = ty
    def pack(self):
        offset = self.stream.pos - self.pos
        self.stream.repack_u32(self.pos, offset)
        self.ty.pack(self.value, self.stream)

class NullRepack:
    def pack(self):
        pass

class TypeBase:
    def embedded_fixed_pack(self, value, stream):
        if self.is_variable_size:
            stream.write_u32(0)
            if not self.is_container or len(value) > 0:
                return OffsetRepack(stream, value, self)
        else:
            self.pack(value, stream)
        return NullRepack()
    def packed(self, value):
        stream = OutputStream()
        self.pack(value, stream)
        return stream.bytes

class Int(TypeBase):
    def __init__(self, bits, isSigned):
        self.bits = bits
        self.isSigned = isSigned
        # Common definitions
        self.fixed_size = (bits + 7) >> 3
        self.is_variable_size = False
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        return Int(raw["bits"], raw["isSigned"])
    def unpack(self, stream):
        result = 0
        for i in range(self.fixed_size):
            b = stream.read(1)[0]
            result = result + (b << (i*8))
        if self.isSigned and result >= (1 << (self.bits - 1)):
            result = result - 1<<self.bits
        return result
    def pack(self, value, stream):
        value = int(value)
        for i in range(self.fixed_size):
            stream.write_u8(value & 0xFF)
            value = value >> 8

class Float(TypeBase):
    def __init__(self, exp, mantissa):
        assert((exp + mantissa) % 8 == 0)
        self.exp = exp
        self.mantissa = mantissa
        self.fixed_size = (exp + mantissa) // 8
        self.is_variable_size = False
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        return Float(raw["exp"], raw["mantissa"])
    def pack(self, value, stream):
        value = float(value)
        sign = 1 if math.copysign(1, value) < 0 else 0
        value = abs(value)
        if math.isinf(value):
            exp = (1 << self.exp) - 1
            mantissa = 0
        elif math.isnan(value):
            exp = (1 << self.exp) - 1
            mantissa = 1 << (self.mantissa - 2)
        elif value == 0:
            (mantissa, exp) = (0, 0)
        else:
            (mantissa, exp) = math.frexp(value)
            # bias is 2*exp - 1, and frexp returns a value in [0.5, 1), instead of [1,2)
            exp += (1 << (self.exp - 1)) - 2
            if exp <= 0:
                # denormalized
                mantissa = int(math.ldexp(mantissa, self.mantissa + exp - 1))
                exp = 0
            else:
                mantissa = int(math.ldexp(mantissa - 0.5, self.mantissa))
        ival = ((sign << (self.exp + self.mantissa - 1)) |
                (exp << (self.mantissa - 1)) |
                mantissa)
        for i in range((self.mantissa + self.exp) // 8):
            stream.write_u8(ival & 0xff)
            ival >>= 8

class Struct(TypeBase):
    def __init__(self, members):
        members = _as_list(members)
        self.fixed_size = 0
        self.is_variable_size = False
        self.is_optional = False
        self.is_container = False
        self.members = members
        for (name, ty) in members:
            if ty.is_variable_size:
                self.fixed_size = 4
                self.is_variable_size = True
                break
            else:
                self.fixed_size += ty.fixed_size
    @staticmethod
    def load(raw, parser):
        members = []
        for (name, ty) in _as_list(raw):
            members.append((name, load_type(ty, parser)))
        return Struct(members)
    def pack(self, value, stream):
        value = dict(value)
        for (name, ty) in self.members:
            ty.pack(value[name], stream)

class Object(TypeBase):
    def __init__(self, members):
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = False
        if members is not None:
            self.members = _as_list(members)
    @staticmethod
    def load(raw, parser):
        result = Object(None)
        def init():
            members = []
            for (name, ty) in _as_list(raw):
                members.append((name, load_type(ty, parser)))
            result.members = members
        parser.post(init)
        return result
    def pack(self, value, stream):
        value = dict(value)
        num_present = 0
        i = 0
        for (name, ty) in self.members:
            i += 1
            if not ty.is_optional or value.get(name) is not None:
                num_present = i
        present_members = self.members[:num_present]
        stream.write_u16(sum(ty.fixed_size for (name, ty) in present_members))
        repack = []
        for (name, ty) in present_members:
            repack.append(ty.embedded_fixed_pack(value.get(name), stream))
        for r in repack:
            r.pack()

class Array(TypeBase):
    def __init__(self, ty, n):
        self.ty = ty
        self.n = n
        self.is_variable_size = ty.is_variable_size
        if ty.is_variable_size:
            self.fixed_size = ty.fixed_size * n
        else:
            self.fixed_size = 4
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        return Array(load_type(raw["type"], parser), int(raw["len"]))
    def pack(self, value, stream):
        assert(len(value) == self.n)
        repack = []
        for item in value:
            repack.append(self.ty.embedded_fixed_pack(item, stream))
        for r in repack:
            r.pack()

class List(TypeBase):
    def __init__(self, ty):
        if ty is not None:
            self.ty = ty
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = True
    @staticmethod
    def load(raw, parser):
        result = List(None)
        def init():
            result.ty = load_type(raw, parser)
        parser.post(init)
        return result
    def pack(self, value, stream):
        stream.write_u32(self.ty.fixed_size * len(value))
        repack = []
        for item in value:
            repack.append(self.ty.embedded_fixed_pack(item, stream))
        for r in repack:
            r.pack()

class Option(TypeBase):
    def __init__(self, ty):
        if ty is not None:
            self.ty = ty
            self.is_container = ty.is_container and not ty.is_optional
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = True
    @staticmethod
    def load(raw, parser):
        result = Option(None)
        def init():
            result.ty = load_type(raw, parser)
            result.is_container = result.ty.is_container and not result.ty.is_optional
        parser.post(init)
        return result
    def pack(self, value, stream):
        if value is None:
            stream.write_u32(1)
        else:
            stream.write_u32(4)
            self.ty.embedded_fixed_pack(value, stream).pack()
    def embedded_fixed_pack(self, value, stream):
        if value is None:
            stream.write_u32(1)
            return NullRepack()
        stream.write_u32(0)
        if self.is_container and len(value) == 0:
            return NullRepack()
        else:
            return OffsetRepack(stream, value, self.ty)

class Variant(TypeBase):
    def __init__(self, members):
        if members is not None:
            self.members = members
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        result = Variant(None)
        def init():
            members = []
            for (name, ty) in _as_list(raw):
                members.append((name, load_type(ty, parser)))
            result.members = members
        parser.post(init)
        return result
    def pack(self, value, stream):
        assert(len(value) == 1)
        for (name, v) in dict(value).items():
            idx = self.members_by_name[name]
            stream.write_u8(idx)
            pos = stream.pos
            stream.write_u32(0)
            self.members[idx][1].pack(v, stream)
            stream.repack_u32(pos, stream.pos - pos - 4)
    @property
    def members_by_name(self):
        if not hasattr(self, "_members_by_name"):
            self._members_by_name = {}
            for (i, (name, ty)) in enumerate(self.members):
                self._members_by_name[name] = i
        return self._members_by_name

class Tuple(TypeBase):
    def __init__(self, members):
        if members is not None:
            self.members = members
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        result = Tuple(None)
        def init():
            members = []
            for ty in raw:
                members.append(load_type(ty, parser))
            result.members = members
        parser.post(init)
        return result
    def pack(self, value, stream):
        assert(len(value) == len(self.members))
        num_present = 0
        i = 0
        for v in value:
            i += 1
            if v is not None:
                num_present = i

        present_members = self.members[:num_present]
        stream.write_u16(sum(ty.fixed_size for ty in present_members))
        repack = []
        for (v, ty) in zip(value, present_members):
            repack.append(ty.embedded_fixed_pack(v, stream))
        for r in repack:
            r.pack()

class FracPack(TypeBase):
    def __init__(self, ty):
        if ty is not None:
            self.ty = ty
        self.is_variable_size = True
        self.fixed_size = 4
        self.is_container = True
        self.is_optional = False
    @staticmethod
    def load(raw, parser):
        result = FracPack(None)
        def init():
            result.ty = load_type(raw, parser)
        parser.post(init)
        return result
    def pack(self, value, stream):
        stream.write_u32(0)
        pos = stream.pos
        self.ty.pack(value, stream)
        stream.repack_u32(pos - 4, stream.pos - pos)

class Custom(TypeBase):
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        ty = load_type(raw["type"], parser)
        id = raw["id"]
        if id in parser.custom:
            # TODO: validate equivalence
            return parser.custom[id](ty)
        return ty

class Type(TypeBase):
    @staticmethod
    def load(raw, parser):
        return parser[raw]

types = {
    "Int": Int,
    "Float": Float,
    "Struct": Struct,
    "Object": Object,
    "Tuple": Tuple,
    "Array": Array,
    "List": List,
    "Option": Option,
    "Variant": Variant,
    "FracPack": FracPack,
    "Custom": Custom,
    "Type": Type
}

def load_type(raw, parser):
    if type(raw) == str:
        return Type.load(raw, parser)
    else:
        assert(len(raw) == 1)
        for (name, data) in dict(raw).items():
            return types[name].load(data, parser)

def _as_list(c):
    ty = type(c)
    assert ty is not dict, "Cannot use dict because the order of elements is significant"
    if ty is list:
        return c
    else:
        if isinstance(c, abc.Mapping):
            c = c.items()
        return list(c)

class Schema:
    def __init__(self, types=None):
        if types is None:
            self.types = {}
        else:
            self.types = {}
            SchemaParser(types, self)
    def __contains__(self, name):
        return name in self.types
    def __setitem__(self, name, ty):
        self.types[name] = ty
    def __getitem__(self, name):
        return self.types[name]

u8 = Int(8, False)
u16 = Int(16, False)
u32 = Int(32, False)
u64 = Int(64, False)
i8 = Int(8, True)
i16 = Int(16, True)
i32 = Int(32, True)
i64 = Int(64, True)

class Bool(Int):
    def __init__(self, ty):
        super().__init__(bits=1, isSigned=False)
    def pack(self, value, stream):
        if value:
            stream.write_u8(1)
        else:
            stream.write_u8(0)

class String(List):
    def __init__(self, ty):
        super().__init__(u8)
    def pack(self, value, stream):
        data = value.encode()
        stream.write_u32(len(data))
        stream.write_bytes(data)

class Hex(TypeBase):
    def __init__(self, ty):
        self.ty = ty
    def pack(self, value, stream):
        data = bytes.fromhex(value)
        if self.ty.is_container:
            stream.write_u32(len(data))
            stream.write_bytes(data)
        else:
            stream.write_bytes(data)
    @property
    def is_variable_size(self):
        return self.ty.is_variable_size
    @property
    def fixed_size(self):
        return self.ty.fixed_size
    @property
    def is_container(self):
        return self.ty.is_container
    @property
    def is_optional(self):
        return self.ty.is_optional

default_custom = {
    "bool": Bool,
    "string": String,
    "hex": Hex
}

class SchemaError(Exception):
    pass

class SchemaParser:
    def __init__(self, types, schema=None, custom=None):
        if type(types) is str:
            types = json.loads(object_pairs_hook=list)
        types = dict(types)
        self.types = types
        if schema is None:
            schema = Schema()
        self.schema = schema
        if custom is None:
            custom = default_custom
        self.custom = custom
        self.fns = []
        for (name, ty) in types.items():
            self[name]
        while len(self.fns):
            fns = self.fns
            self.fns = []
            for f in fns:
                f()
    def __getitem__(self, name):
        if name in self.schema:
            result = self.schema[name]
            if result is None:
                raise SchemaError("%s depends on itself" % name)
            return result
        else:
            self.schema[name] = None
            self.schema[name] = load_type(self.types[name], self)
            return self.schema[name]
    def post(self, fn):
        self.fns.append(fn)
