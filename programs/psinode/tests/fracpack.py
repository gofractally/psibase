import math
import json
import itertools
from collections import abc
from functools import wraps

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

class FracpackError(Exception):
    pass

class BadOffset(FracpackError):
    def __init__(self):
        super().__init__(self, "Invalid offset")

class BadSize(FracpackError):
    def __init__(self):
        super().__init__(self, "Invalid size")

class MissingField(FracpackError):
    def __init__(self, ty, name):
        super().__init__(self, "Missing field %s.%s" % (ty.__name__, name))

class InputStream:
    def __init__(self, data, custom=None):
        self.bytes = data
        self.pos = 0
        self.known_pos = True
        if custom is not None:
            self.custom = custom
    def read_u8(self):
        try:
            result = self.bytes[self.pos]
            self.pos += 1
            return result
        except IndexError as e:
            raise FracpackError('Out of bounds')
    def read_u16(self):
        result = 0
        for i in range(2):
            result |= self.read_u8() << 8*i;
        return result
    def read_u32(self):
        result = 0
        for i in range(4):
            result |= self.read_u8() << 8*i;
        return result
    def read_bytes(self, n):
        if self.pos + n > len(self.bytes):
            raise FracpackError('Out of bounds')
        result = self.bytes[self.pos:self.pos+n]
        self.pos += n
        return result
    def set_pos(self, new_pos):
        if self.known_pos:
            if self.pos != new_pos:
                raise BadOffset()
        else:
            if self.pos > new_pos:
                raise BadOffset()
            self.pos = new_pos
            self.known_pos = True
    def save(self, new_pos):
        state = (self.pos, self.known_pos)
        self.pos = new_pos
        self.known_pos = True
        return state
    def restore(self, state):
        (pos, known_pos) = state
        self.pos = pos
        self.known_pos = known_pos

class _OffsetRepack:
    def __init__(self, stream, value, ty):
        self.pos = stream.pos - 4
        self.stream = stream
        self.value = value
        self.ty = ty
    def pack(self):
        offset = self.stream.pos - self.pos
        self.stream.repack_u32(self.pos, offset)
        self.ty.pack(self.value, self.stream)

class _NullRepack:
    def pack(self):
        pass

class _OffsetUnpack:
    def __init__(self, stream, offset, ty):
        self.pos = stream.pos - 4 + offset
        self.stream = stream
        self.ty = ty
    def unpack(self):
        self.stream.set_pos(self.pos)
        return self.ty.unpack(self.stream)

class _OffsetUnpackNonEmpty(_OffsetUnpack):
    def unpack(self):
        result = super().unpack()
        if self.ty.is_empty_container(result, self.stream):
            raise FracpackError('Empty containers must use zero offset')
        return result

class _InlineUnpack:
    def __init__(self, value):
        self.value = value
    def unpack(self):
        return self.value

NullUnpack = _InlineUnpack(None)

class TypeBase(type):
    def pack(self, value, stream):
        assert self.is_optional
        self.embedded_pack(value, stream).pack()
    def unpack(self, stream):
        assert self.is_optional
        return self.embedded_unpack(stream).unpack()
    def embedded_pack(self, value, stream):
        assert not self.is_optional
        if self.is_variable_size:
            stream.write_u32(0)
            if not self.is_container or not self.is_empty_container(value, stream):
                return _OffsetRepack(stream, value, self)
        else:
            self.pack(value, stream)
        return _NullRepack()
    def embedded_unpack(self, stream):
        assert not self.is_optional
        if self.is_variable_size:
            offset = stream.read_u32()
            if offset == 0:
                return _InlineUnpack(self.new_empty_container(stream))
            elif self.is_container:
                return _OffsetUnpackNonEmpty(stream, offset, self)
            else:
                return _OffsetUnpack(stream, offset, self)
        else:
            return _InlineUnpack(self.unpack(stream))
    def new_empty_container(self, stream):
        try:
            state = stream.save(stream.pos - 4)
            return self.unpack(stream)
        finally:
            stream.restore(state)
    def packed(self, value):
        stream = OutputStream()
        self.pack(value, stream)
        return stream.bytes
    def get_canonical(self):
        return self

def pack(value, ty=None, *, custom=None):
    if ty is None:
        ty = type(value)
    stream = OutputStream(custom)
    ty.pack(value, stream)
    return stream.bytes

def unpack(data, ty=None, *, custom=None):
    if ty is None:
        ty = type(value)
    stream = InputStream(data, custom)
    result = ty.unpack(stream)
    stream.set_pos(len(stream.bytes))
    return result

class TypeCompatibility:
    __slots__ = ['addField', 'addAlternative', 'dropField', 'dropAlternative']
    def __init__(self, *, addField=False, addAlternative=False, dropField=False, dropAlternative=False):
        self.addField = addField
        self.addAlternative = addAlternative
        self.dropField = dropField
        self.dropAlternative = dropAlternative
    def __repr__(self):
        return 'TypeCompatibility(addField=%s, addAlternative=%s, dropField=%s, dropAlternative=%s)' % \
            (self.addField, self.addAlternative, self.dropField, self.dropAlternative)
    def __eq__(self, other):
        if not isinstance(other, TypeCompatibility):
            return NotImplemented
        return self.addField == other.addField and \
            self.addAlternative == other.addAlternative and \
            self.dropField == other.dropField and \
            self.dropAlternative == other.dropAlternative
    def equivalent(self):
        return self == TypeCompatibility()

class _MatchContext:
    def __init__(self):
        self.lstack = {}
        self.rstack = {}
        self.compatibility = TypeCompatibility()
        self.known = set()
    def match(self, lhs, rhs):
        lhs = lhs.get_canonical()
        rhs = rhs.get_canonical()
        lid = id(lhs)
        rid = id(rhs)
        if self.lstack.get(lid, -1) != self.rstack.get(rid, -1):
            return False
        if (lid, rid) in self.known:
            return True

        n = len(self.lstack)
        self.lstack[lid] = n
        self.rstack[rid] = n

        result = lhs.match(rhs, self)

        if result:
            self.known.add((lid, rid))

        del self.lstack[lid]
        del self.rstack[rid]

        return result

    def member_types(self, ty):
        if isinstance(ty, Object):
            return [v for (k,v) in ty.members]
        elif isinstance(ty, Tuple):
            return ty.members

    def match_tuple(self, lhs, rhs):
        if not isinstance(rhs, Tuple) and not isinstance(rhs, Object):
            return False
        lmembers = self.member_types(lhs)
        rmembers = self.member_types(rhs)
        for (l, r) in itertools.zip_longest(lmembers, rmembers, fillvalue=_TrailingOption()):
            if not self.match(l, r):
                return False
        return True

def compatibility(lhs, rhs):
    context = _MatchContext()
    if not context.match(lhs, rhs):
        return None
    return context.compatibility

def is_equivalent(lhs, rhs):
    compat = compatibility(lhs, rhs)
    return compat is not None and compat.equivalent()

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
        @wraps(cls.__init__)
        def __init__(self, *args, **kw):
            (args, kw, extra) = _handle_args(args, kw, argnames, gentype, base)
            if extra is not None:
                original_init(self, *extra)
            super(cls, self).__init__(*args, **kw)
        cls.__init__ = __init__
        return cls
    return fn

class _UnknownType:
    def __init__(self):
        self.is_container = False
    def unpack(self, stream):
        stream.known_pos = False
        pass

_Unknown = _UnknownType()

@_fracpackmeta([], lambda: 'TrailingOption')
class _TrailingOption(TypeBase):
    def __init__(self):
        pass
    def embedded_unpack(self, stream):
        offset = stream.read_u32()
        if offset > 1:
            return _OffsetUnpack(stream, offset, _Unknown)
        if offset == 1:
            return NullUnpack
        else:
            return _InlineUnpack(None)
    def match(self, other, context):
        if isinstance(other, Option):
            context.compatibility.addField = True
            return True
        return False

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
            b = stream.read_u8()
            result = result + (b << (i*8))
        if self.isSigned and result >= (1 << (self.fixed_size*8 - 1)):
            result = result - (1<<self.bits)
        if self.isSigned:
            if not (-(1 << (self.bits - 1)) <= result < (1 << (self.bits - 1))):
                raise FracpackError('%d is out of range for %s' % (result, self.__name__))
        else:
            if result >= (1 << self.bits):
                raise FracpackError('%d is out of range for %s' % (result, self.__name__))
        return result
    def pack(self, value, stream):
        value = int(value)
        for i in range(self.fixed_size):
            stream.write_u8(value & 0xFF)
            value = value >> 8
    def match(self, other, context):
        if not isinstance(other, Int):
            return False
        return self.bits == other.bits and self.isSigned == other.isSigned

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
    def unpack(self, stream):
        ival = 0
        for i in range((self.mantissa + self.exp) // 8):
            ival = ival | (stream.read_u8() << 8*i)
        sign = (ival >> (self.exp + self.mantissa - 1)) & 1
        exp = (ival >> (self.mantissa - 1)) & ((1 << self.exp) - 1)
        mantissa = ival & ((1 << (self.mantissa - 1)) - 1)
        bias = (1 << (self.exp - 1)) - 1
        if exp == 0:
            result = math.ldexp(float(mantissa), -bias + 2 - self.mantissa)
        elif exp == (1 << self.exp) - 1:
            if mantissa == 0:
                result = math.inf
            else:
                result = math.nan
        else:
            result = math.ldexp(float(mantissa + (1 << (self.mantissa - 1))), exp - bias - self.mantissa + 1)
        if sign:
            result = -result
        return result
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
    def match(self, other, context):
        if not isinstance(other, Float):
            return False
        return self.exp == other.exp and self.mantissa == other.mantissa

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

class _MembersByName:
    @property
    def members_by_name(self):
        if not hasattr(self, "_members_by_name"):
            self._members_by_name = {}
            for (i, (name, ty)) in enumerate(self.members):
                self._members_by_name[name] = i
        return self._members_by_name

@_fracpackmeta(['name', 'members'], lambda name, members: name, ObjectValue)
class Struct(TypeBase, _MembersByName, metaclass=DerivedAsInstance):
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
    def unpack(self, stream):
        fields = {}
        for (name, ty) in self.members:
            fields[name] = ty.embedded_unpack(stream)
        for (name, ty) in self.members:
            fields[name] = fields[name].unpack()
        return fields
    def pack(self, value, stream):
        if isinstance(value, ObjectValue):
            value = value.__dict__
        else:
            value = dict(value)
        fields = []
        for (name, ty) in self.members:
            fields.append(ty.embedded_pack(value[name], stream))
        for field in fields:
            field.pack()
    def match(self, other, context):
        if not isinstance(other, Struct):
            return False
        if not len(self.members) == len(other.members):
            return false
        for ((ln,l), (rn,r)) in zip(self.members, other.members):
            if not context.match(l, r):
                return False
        return True

@_fracpackmeta(['name', 'members'], lambda name, members: name, ObjectValue)
class Object(TypeBase, _MembersByName, metaclass=DerivedAsInstance):
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
    def unpack(self, stream):
        result = {}
        fixed_size = stream.read_u16()
        fixed_end = stream.pos + fixed_size
        last = None
        at_end = False
        for (name, ty) in self.members:
            if stream.pos + ty.fixed_size > fixed_end:
                at_end = True
            if at_end:
                if stream.pos == fixed_end:
                    if ty.is_optional:
                        result[name] = _InlineUnpack(None)
                    else:
                        raise MissingField(self, name)
                else:
                    raise BadSize()
            else:
                last = name
                result[name] = ty.embedded_unpack(stream)
        extra = []
        while stream.pos < fixed_end:
            extra.append(_TrailingOption().embedded_unpack(stream))
        if len(extra) != 0:
            last_value = extra[-1]
        elif last is not None:
            last_value = result[last]
        else:
            last_value = None
        if last_value is NullUnpack:
            raise FracpackError('Last optional must not be empty')
        for (name, ty) in self.members:
            result[name] = result[name].unpack()
        for e in extra:
            e.unpack()
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
            field = value.get(name) if ty.is_optional else value[name]
            repack.append(ty.embedded_pack(field, stream))
        for r in repack:
            r.pack()
    def match(self, other, context):
        return context.match_tuple(self, other)

@_fracpackmeta(['type', 'len'], lambda type, len: '%s[%d]' % (type.__name__, len), list)
class Array(TypeBase):
    def __init__(self, ty, n):
        '''
        ty: The array element type
        n: The number of elements in the array
        '''
        self.ty = ty
        self.n = n
        self.is_variable_size = ty.is_variable_size
        if not ty.is_variable_size:
            self.fixed_size = ty.fixed_size * n
        else:
            self.fixed_size = 4
        self.is_optional = False
        self.is_container = False
    @staticmethod
    def load(raw, parser):
        raw = dict(raw)
        return Array(load_type(raw["type"], parser), int(raw["len"]))
    def unpack(self, stream):
        result = [self.ty.embedded_unpack(stream) for i in range(self.n)]
        for i in range(self.n):
            result[i] = result[i].unpack()
        return result
    def pack(self, value, stream):
        assert(len(value) == self.n)
        repack = []
        for item in value:
            repack.append(self.ty.embedded_pack(item, stream))
        for r in repack:
            r.pack()
    def match(self, other, context):
        if not isinstance(other, Array):
            return False
        return self.n == other.n and context.match(self.ty, other.ty)

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
    def is_empty_container(self, value, stream):
        return len(value) == 0
    def unpack(self, stream):
        size = stream.read_u32()
        if size % self.ty.fixed_size != 0:
            raise BadSize()
        result = [self.ty.embedded_unpack(stream) for i in range(0, size, self.ty.fixed_size)]
        for i in range(len(result)):
            result[i] = result[i].unpack()
        return result
    def pack(self, value, stream):
        ty = self.ty
        stream.write_u32(self.ty.fixed_size * len(value))
        repack = []
        for item in value:
            repack.append(self.ty.embedded_pack(item, stream))
        for r in repack:
            r.pack()
    def match(self, other, context):
        if isinstance(other, FracPack) and context.match(self.ty, u8):
            context.compatibility.dropAlternative = True
            return True
        if not isinstance(other, List):
            return False
        return context.match(self.ty, other.ty)

class OptionValue:
    def __init__(self, value=None):
        self.value = value

@_fracpackmeta(['type'], lambda type: '%s?' % (type.__name__) if type is not None else 'Option', OptionValue)
class Option(TypeBase):
    def __init__(self, ty):
        if ty is not None:
            self.ty = ty
        self.fixed_size = 4
        self.is_variable_size = True
        self.is_optional = True
    @staticmethod
    def load(raw, parser):
        result = Option(None)
        def init():
            result.ty = load_type(raw, parser)
        parser.post(init)
        return result
    def is_empty_container(self, value, stream):
        if isinstance(value, OptionValue):
            value = value.value
        return value is not None and self.ty.is_empty_container(value, stream)
    def embedded_unpack(self, stream):
        offset = stream.read_u32()
        if offset == 1:
            return NullUnpack
        elif self.is_container:
            if offset == 0:
                return _InlineUnpack(self.ty.new_empty_container(stream))
            else:
                return _OffsetUnpackNonEmpty(stream, offset, self.ty)
        else:
            return _OffsetUnpack(stream, offset, self.ty)
    def embedded_pack(self, value, stream):
        if isinstance(value, OptionValue):
            value = value.value
        if value is None:
            stream.write_u32(1)
            return _NullRepack()
        stream.write_u32(0)
        if self.is_container and self.is_empty_container(value, stream):
            return _NullRepack()
        else:
            return _OffsetRepack(stream, value, self.ty)
    @property
    def is_container(self):
        return self.ty.is_container and not self.ty.is_optional
    def match(self, other, context):
        if isinstance(other, _TrailingOption):
            context.compatibility.dropField = True
            return True
        if not isinstance(other, Option):
            return False
        return context.match(self.ty, other.ty)

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
    def unpack(self, stream):
        idx = stream.read_u8()
        if idx >= len(self.members):
            raise FracpackError('Unknown variant alternative')
        size = stream.read_u32()
        end_pos = stream.pos + size
        result = self.members[idx][1].unpack(stream)
        stream.set_pos(end_pos)
        return {self.members[idx][0]: result}
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
    def match(self, other, context):
        if not isinstance(other, Variant):
            return False
        for ((lname, lty), (rname, rty)) in zip(self.members, other.members):
            if not context.match(lty, rty):
                return False
        if len(self.members) < len(other.members):
            context.compatibility.addAlternative = True
        elif len(self.members) > len(other.members):
            context.compatibility.dropAlternative = True
        return True

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
    def unpack(self, stream):
        result = []
        fixed_size = stream.read_u16()
        fixed_end = stream.pos + fixed_size
        last = None
        at_end = False
        for (i, ty) in enumerate(self.members):
            if stream.pos + ty.fixed_size > fixed_end:
                at_end = True
            if at_end:
                if stream.pos == fixed_end:
                    if ty.is_optional:
                        result.append(_InlineUnpack(None))
                    else:
                        raise MissingField(self, i)
                else:
                    raise BadSize()
            else:
                last = i
                result.append(ty.embedded_unpack(stream))
        extra = []
        while stream.pos < fixed_end:
            extra.append(_TrailingOption().embedded_unpack(stream))
        if len(extra) != 0:
            last_value = extra[-1]
        elif last is not None:
            last_value = result[last]
        else:
            last_value = None
        if last_value is NullUnpack:
            raise FracpackError('Last optional must not be empty')
        for i in range(len(self.members)):
            result[i] = result[i].unpack()
        for e in extra:
            e.unpack()
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
            repack.append(ty.embedded_pack(v, stream))
        for r in repack:
            r.pack()
    def match(self, other, context):
        return context.match_tuple(self, other)

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
    def is_empty_container(self, value, stream):
        return self.ty.fixed_size == 0
    def unpack(self, stream):
        size = stream.read_u32()
        end_pos = stream.pos + size
        result = self.ty.unpack(stream)
        stream.set_pos(end_pos)
        return result
    def pack(self, value, stream):
        stream.write_u32(0)
        pos = stream.pos
        self.ty.pack(value, stream)
        stream.repack_u32(pos - 4, stream.pos - pos)
    def match(self, other, context):
        if isinstance(other, FracPack):
            return context.match(self.ty, other.ty)
        if isinstance(other, List) and context.match(other.ty, u8):
            context.compatibility.addAlternative = True
            return True
        return False

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
            resolved = parser.custom[id]
            result = Custom(ty, id)
            result._pending = resolved
            return result
        return ty
    def resolve(self, stream, forward):
        if hasattr(self, '_resolved'):
            return self._resolved
        if hasattr(self, '_pending'):
            if not isinstance(self._pending, TypeBase):
                self._resolved = self._pending(self.type)
            elif is_equivalent(self._pending, self.type):
                self._resolved = self._pending
            else:
                self._resolved = self.type
            del self._pending
            return self._resolved
        if hasattr(stream, 'custom'):
            actual = stream.custom.get(self.id)
            if actual is not None and actual is not self:
                return actual
        if forward:
            return self.type
        else:
            return super()
    def is_empty_container(self, value, stream):
        return self.resolve(stream, True).is_empty_container(value, stream)
    def unpack(self, stream):
        return self.resolve(stream, not self.is_optional).unpack(stream)
    def pack(self, value, stream):
        self.resolve(stream, not self.is_optional).pack(value, stream)
    def embedded_unpack(self, stream):
        return self.resolve(stream, self.is_optional).embedded_unpack(stream)
    def embedded_pack(self, value, stream):
        return self.resolve(stream, self.is_optional).embedded_pack(value, stream)
    def get_canonical(self):
        return self.type.get_canonical()
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
        self.custom = custom
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
    def unpack(stream):
        return bool(u1.unpack(stream))
    @staticmethod
    def pack(value, stream):
        u1.pack(int(value), stream)

class String(Custom(List(u8), "string"), str):
    @staticmethod
    def is_empty_container(value, stream):
        return len(value) == 0
    @staticmethod
    def unpack(stream):
        size = stream.read_u32()
        data = stream.read_bytes(size)
        return data.decode()
    @staticmethod
    def pack(value, stream):
        data = value.encode()
        stream.write_u32(len(data))
        stream.write_bytes(data)

@_fracpackmeta(['type'], lambda type: 'Hex', object)
class Hex(TypeBase):
    def __init__(self, ty):
        self.ty = ty
    def unpack(self, stream):
        if self.ty.is_container:
            size = stream.read_u32()
        else:
            assert not self.ty.is_variable_size
            size = self.ty.fixed_size
        return stream.read_bytes(size).hex()
    def pack(self, value, stream):
        if isinstance(value, str):
            value = bytes.fromhex(value)
        if self.ty.is_container:
            stream.write_u32(len(value))
            stream.write_bytes(value)
        else:
            stream.write_bytes(value)
    def is_empty_container(self, value, stream):
        return len(value) == 0
    def get_canonical(self):
        return self.ty
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

def _as_pair(item):
    if isinstance(item, tuple):
        return item
    else:
        return tuple(item.values())

@_fracpackmeta(['type'], lambda type: 'Map', object)
class Map(TypeBase):
    def __init__(self, ty):
        self.ty = ty
    def unpack(self, stream):
        return dict(_as_pair(item) for item in self.ty.unpack(stream))
    def pack(self, value, stream):
        elemtype = self.ty.ty
        if issubclass(self.ty, elemtype):
            value = value.items()
        else:
            value = [elemtype(*item) for item in value.items()]
        self.ty.pack(value, stream)
    def is_empty_container(self, value, stream):
        return len(value) == 0
    def get_canonical(self):
        return self.ty
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
    "hex": Hex,
    "map": Map,
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
