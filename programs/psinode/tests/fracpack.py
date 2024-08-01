import math
import json
from collections import abc

class OutputStream:
    def __init__(self, custom=None):
        self.bytes = bytearray()
        if custom is not None:
            self.custom = custom
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

class TypeBase(type):
    def embedded_fixed_pack(self, value, stream):
        if self.is_variable_size:
            stream.write_u32(0)
            if not self.is_container or not self.is_empty_container(value):
                return OffsetRepack(stream, value, self)
        else:
            self.pack(value, stream)
        return NullRepack()
    def packed(self, value):
        stream = OutputStream()
        self.pack(value, stream)
        return stream.bytes

def pack(value, ty=None, *, custom=None):
    if ty is None:
        ty = type(value)
    stream = OutputStream(custom)
    ty.pack(value, stream)
    return stream.bytes

def _handle_args(args, kw, extra, genname, base):
    assert len(extra) != 3
    def handle_args_class(name, bases, dict, **kw):
        extra_values = []
        for i in range(len(extra)):
            n = extra[i]
            extra_values.append(kw.get(n))
            if n in kw:
                del kw[n]
        return ((name, bases, dict), kw, extra_values)

    if len(args) == 3 or 'dict' in kw:
        ((name, bases, dict), kw, extra) = handle_args_class(*args, **kw)
        if not any(issubclass(b, base) for b in bases):
            bases += (base,)
        else:
            extra_values = None
        return ((name, bases, dict), kw, extra_values)
    else:
        if len(extra) < len(args):
            raise Exception("Too many args")
        extra_values = []
        for i in range(len(extra)):
            if i < len(args):
                extra_values.append(args[i])
            else:
                name = extra[i]
                extra_values.append(kw[name])
                del kw[name]
        for (k, v) in kw.items():
            raise Exception("Extra argument: %s=%s" % (k, v))
        return ((genname(*extra_values), (base,), {}), {}, extra_values)

# Adjusts __init__ and __new__ to forward the correct arguments to type.
def _fracpackmeta(argnames, gentype, base=object):
    def fn(cls):
        def __new__(c, *args, **kw):
            (args, kw, extra) = _handle_args(args, kw, argnames, gentype, base)
            return super(cls, c).__new__(cls, *args, **kw)
        cls.__new__ = staticmethod(__new__)
        original_init = cls.__init__
        def __init__(self, *args, **kw):
            (args, kw, extra) = _handle_args(args, kw, argnames, gentype, base)
            if extra is not None:
                original_init(self, *extra)
            super(cls, self).__init__(*args, **kw)
        cls.__init__ = __init__
        return cls
    return fn

@_fracpackmeta(['bits', 'isSigned'], lambda bits, isSigned: '%s%d' % ('s' if isSigned else 'u', bits), int)
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

@_fracpackmeta(['exp', 'mantissa'], lambda exp, mantissa: 'f%d' % (exp + mantissa), float)
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

class ObjectValue:
    def __init__(self, *args, **kw):
        cls = type(self)
        for ((name, ty), value) in zip(cls.members, args):
            self.__dict__[name] = value
        for (name, value) in kw.items():
            if name in self.__dict__:
                raise Exception('%s is already defined' % name)
            if name not in cls.members_by_name:
                raise Exception('%s is not a member of %s' % (name, cls))
            self.__dict__[name] = value
        for (name, ty) in cls.members:
            if name not in self.__dict__:
                if ty.is_optional:
                    self.__dict__[name] = None
                else:
                    raise Exception('%s is required' % name)

class DerivedAsInstance(type):
    def __new__(cls, name, bases, namespace, **kw):
        for base in bases:
            if isinstance(base, DerivedAsInstance):
                members = {}
                if '__annotations__' in namespace:
                    for (n, ty) in namespace['__annotations__'].items():
                        if isinstance(ty, TypeBase):
                            members[n] = ty
                return base(name, members)
        return super().__new__(cls, name, bases, namespace, **kw)

class MembersByName:
    @property
    def members_by_name(self):
        if not hasattr(self, "_members_by_name"):
            self._members_by_name = {}
            for (i, (name, ty)) in enumerate(self.members):
                self._members_by_name[name] = i
        return self._members_by_name

@_fracpackmeta(['name', 'members'], lambda name, members: name, ObjectValue)
class Struct(TypeBase, MembersByName, metaclass=DerivedAsInstance):
    def __init__(self, name, members):
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
        return Struct('<anonymous Struct>', members)
    def pack(self, value, stream):
        if isinstance(value, ObjectValue):
            value = value.__dict__
        else:
            value = dict(value)
        for (name, ty) in self.members:
            ty.pack(value[name], stream)

@_fracpackmeta(['name', 'members'], lambda name, members: name, ObjectValue)
class Object(TypeBase, MembersByName, metaclass=DerivedAsInstance):
    def __init__(self, name, members):
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = False
        if members is not None:
            self.members = _as_list(members)
    @staticmethod
    def load(raw, parser):
        result = Object("<anonymous>", None)
        def init():
            members = []
            for (name, ty) in _as_list(raw):
                members.append((name, load_type(ty, parser)))
            result.members = members
        parser.post(init)
        return result
    def pack(self, value, stream):
        if isinstance(value, ObjectValue):
            value = value.__dict__
        else:
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

@_fracpackmeta(['type', 'len'], lambda type, len: '%s[%d]' % (type.__name__, len), list)
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

@_fracpackmeta(['type'], lambda ty: ty.__name__ + '[]' if ty is not None else 'List', list)
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
    def is_empty_container(self, value):
        return len(value) == 0
    def pack(self, value, stream):
        ty = self.ty
        stream.write_u32(self.ty.fixed_size * len(value))
        repack = []
        for item in value:
            repack.append(self.ty.embedded_fixed_pack(item, stream))
        for r in repack:
            r.pack()

class OptionValue:
    def __init__(self, value=None):
        self.value = value

@_fracpackmeta(['type'], lambda type: '%s?' % (type.__name__) if type is not None else 'Option', OptionValue)
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
    def is_empty_container(self, value):
        if isinstance(value, OptionValue):
            value = value.value
        return value is not None and self.ty.is_empty_container(value)
    def pack(self, value, stream):
        if isinstance(value, OptionValue):
            value = value.value
        if value is None:
            stream.write_u32(1)
        else:
            stream.write_u32(4)
            self.ty.embedded_fixed_pack(value, stream).pack()
    def embedded_fixed_pack(self, value, stream):
        if isinstance(value, OptionValue):
            value = value.value
        if value is None:
            stream.write_u32(1)
            return NullRepack()
        stream.write_u32(0)
        if self.is_container and self.is_empty_container(value):
            return NullRepack()
        else:
            return OffsetRepack(stream, value, self.ty)

class VariantValue:
    def __init__(self, type, value):
        self.type = type
        self.value = value

@_fracpackmeta(['name', 'members'], lambda name, members: name, VariantValue)
class Variant(TypeBase, metaclass=DerivedAsInstance):
    def __init__(self, name, members):
        if members is not None:
            self.members = _as_list(members)
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        result = Variant('<anonymous variant>', None)
        def init():
            members = []
            for (name, ty) in _as_list(raw):
                members.append((name, load_type(ty, parser)))
            result.members = members
        parser.post(init)
        return result
    def pack(self, value, stream):
        if isinstance(value, VariantValue):
            value = {value.type: value.value}
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

@_fracpackmeta(['members'], lambda members: 'Tuple', tuple)
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

@_fracpackmeta(['type'], lambda ty: 'FracPack', object)
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
    def is_empty_container(self, value):
        return self.ty.fixed_size == 0
    def pack(self, value, stream):
        stream.write_u32(0)
        pos = stream.pos
        self.ty.pack(value, stream)
        stream.repack_u32(pos - 4, stream.pos - pos)

@_fracpackmeta(['type', 'id'], lambda ty, id: id, object)
class Custom(TypeBase):
    def __init__(self, type, id):
        self.type = type
        self.id = id
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        ty = load_type(raw["type"], parser)
        id = raw["id"]
        if id in parser.custom:
            # TODO: validate equivalence
            result = parser.custom[id]
            if isinstance(result, TypeBase):
                return result
            else:
                return result(ty)
        return ty
    def pack(self, value, stream):
        if hasattr(stream, 'custom'):
            actual = stream.custom.get(self.id)
        else:
            actual = None
        if actual is not None:
            actual.pack(value, stream)
        else:
            self.type.pack(value, stream)
    @property
    def is_variable_size(self):
        return self.type.is_variable_size
    @property
    def fixed_size(self):
        return self.type.fixed_size
    @property
    def is_container(self):
        return self.type.is_container
    @property
    def is_optional(self):
        return self.type.is_optional

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
    if isinstance(c, list):
        return c
    else:
        if isinstance(c, abc.Mapping):
            c = c.items()
        return list(c)

class Schema:
    def __init__(self, types=None, custom=None):
        if types is None:
            self.types = {}
        else:
            self.types = {}
            SchemaParser(types, self, custom)
    def __contains__(self, name):
        return name in self.types
    def __setitem__(self, name, ty):
        self.types[name] = ty
    def __getitem__(self, name):
        return self.types[name]
    def post(self, f):
        f()

u1 = Int(1, False)
u8 = Int(8, False)
u16 = Int(16, False)
u32 = Int(32, False)
u64 = Int(64, False)
i8 = Int(8, True)
i16 = Int(16, True)
i32 = Int(32, True)
i64 = Int(64, True)

f32 = Float(8, 24)
f64 = Float(11, 53)

class Bool(u1):
    @staticmethod
    def pack(value, stream):
        u1.pack(int(value), stream)

class String(Custom(List(u8), "string"), str):
    @staticmethod
    def is_empty_container(value):
        return len(value) == 0
    @staticmethod
    def pack(value, stream):
        data = value.encode()
        stream.write_u32(len(data))
        stream.write_bytes(data)

@_fracpackmeta(['type'], lambda type: 'Hex', object)
class Hex(TypeBase):
    def __init__(self, ty):
        self.ty = ty
    def pack(self, value, stream):
        if isinstance(value, str):
            value = bytes.fromhex(value)
        if self.ty.is_container:
            stream.write_u32(len(value))
            stream.write_bytes(value)
        else:
            stream.write_bytes(value)
    def is_empty_container(self, value):
        return len(value) == 0
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

Bytes = Hex(List(u8))

default_custom = {
    "bool": Bool,
    "string": String,
    "hex": Hex
}

class FunctionType:
    def __init__(self, params, result=None):
        self.params = params
        self.result = result

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
