
class Int:
    def __init__(self, bits, isSigned):
        self.bits = bits
        self.isSigned = isSigned
        # Common definitions
        self.fixed_size = (bits + 7) >> 3
        self.is_variable_size = False
        self.is_optional = False
        self.is_container = False
    def unpack(self, stream):
        result = 0
        for i in range(self.fixed_size):
            b = stream.read(1)[0]
            result = result + (b << (i*8))
        if self.isSigned:
            result = result - 1<<self.bits
        return result
