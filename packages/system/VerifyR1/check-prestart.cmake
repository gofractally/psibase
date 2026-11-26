# Fails unless wasm-ctor-eval evaluated prestart completely. When it does, it
# removes the export; when it stops part way (an instruction it cannot
# evaluate, such as memory.grow) it leaves the export and the rest of the
# function in place, and the service would pay the set-up on every start.
#
# usage: cmake -DWASM=<file> -P check-prestart.cmake
file(READ "${WASM}" contents HEX)
# "prestart" as it appears in the export section: length 8, then the name
string(FIND "${contents}" "087072657374617274" found)
if(NOT found EQUAL -1)
    file(REMOVE "${WASM}")
    message(FATAL_ERROR "${WASM}: prestart was not fully evaluated by wasm-ctor-eval; the service is not pre-initialized")
endif()
