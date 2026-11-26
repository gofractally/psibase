# Applied to the Botan source before it is configured (see wasm-botan in the
# root CMakeLists.txt).
#
# Botan chooses the word its big-integer and curve arithmetic work in from the
# size of a pointer. On wasm32 a pointer is 32 bits, but the machine has 64-bit
# registers, and with -mwide-arithmetic a 64x64->128 multiply is one
# instruction. With 64-bit words P-256 verification is about three times
# faster than with 32-bit words.
#
# usage: cmake -DTYPES_H=<source>/src/lib/utils/types.h -P patch-botan-word64.cmake
set(from "static constexpr bool HasNative64BitRegisters = sizeof(void*) >= 8;")
set(to "static constexpr bool HasNative64BitRegisters = true;")
file(READ "${TYPES_H}" contents)
string(FIND "${contents}" "${to}" done)
if(done EQUAL -1)
    string(FIND "${contents}" "${from}" found)
    if(found EQUAL -1)
        message(FATAL_ERROR "${TYPES_H}: the definition of HasNative64BitRegisters is not the one this patch expects. Botan would be built with 32-bit words; refusing to continue.")
    endif()
    string(REPLACE "${from}" "${to}" contents "${contents}")
    file(WRITE "${TYPES_H}" "${contents}")
endif()
