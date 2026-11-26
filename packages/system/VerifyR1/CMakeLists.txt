# Stack and initial memory of verify-r1. Both are the least that the service
# was found to need, and both have to be found again when Botan, the compiler
# or the allocator changes.
#
# Initial memory: the build-time pre-initialization (prestart, below) cannot
# grow memory, because wasm-ctor-eval cannot evaluate memory.grow, so the
# module has to start with all that prestart uses. 6 pages is the fewest with
# which it completes; with 5 the build stops at check-prestart ("prestart was
# not fully evaluated"). To find it again: set VERIFY_R1_PAGES to 2 and raise
# it one at a time until `ninja VerifyR1` succeeds. (Botan 3.14.1, wasi-sdk's
# allocator: 2 to 5 fail, 6 succeeds, with any stack from 4 KiB to 64 KiB.)
# A verification needs no more than prestart did, since prestart is one.
#
# Stack: 8 KiB, the default for services. 4 KiB passes the verifier tests and
# 2 KiB does not (the stack is first in memory, so running out of it is a
# trap, here already in prestart: the build fails). 8 KiB is twice what was
# found to be enough.
set(VERIFY_R1_STACK 8192)
set(VERIFY_R1_PAGES 6)
math(EXPR VERIFY_R1_INITIAL_MEMORY "${VERIFY_R1_PAGES} * 65536")
set(VERIFY_R1_MEMORY -Wl,-z,stack-size=${VERIFY_R1_STACK} -Wl,--initial-memory=${VERIFY_R1_INITIAL_MEMORY})

function(add suffix)
    add_executable(VerifyR1${suffix} src/VerifyR1.cpp)
    target_mapped_include_directories(VerifyR1${suffix} PUBLIC include)
    # Botan allocates, so this service has the full allocator, unlike the other verifiers.
    target_link_libraries(VerifyR1${suffix} PUBLIC services_system${suffix} psibase-service${suffix})

    # Botan's fixed-size curve arithmetic, which is internal to Botan: the
    # headers are in botan-3-internal, apart from the public ones. This
    # service is written against the version the root CMakeLists.txt pins
    # (wasm-botan); see the comment there and in src/VerifyR1.cpp.
    target_include_directories(VerifyR1${suffix} PUBLIC
        ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3
        ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3-internal)
    target_link_libraries(VerifyR1${suffix} PUBLIC -lbotan-3 exception-stub${suffix} ${VERIFY_R1_MEMORY})
    set_target_properties(VerifyR1${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifyR1-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    # Setting up the curve costs several times a verification, so it is done
    # here once: prestart is evaluated and the deployed module starts from the
    # memory it left. check-prestart fails the build if prestart was not
    # evaluated to the end (the export would still be there). wasm-opt then
    # drops the code that only prestart reached.
    #
    # The features are named one by one: --all-features makes binaryen emit
    # an encoding that wasmtime rejects.
    add_custom_command(TARGET VerifyR1${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int
            --enable-mutable-globals --enable-wide-arithmetic --enable-multivalue
            VerifyR1-prestart${suffix}.wasm
            -o VerifyR1-evaluated${suffix}.wasm
        COMMAND ${CMAKE_COMMAND}
            -DWASM=VerifyR1-evaluated${suffix}.wasm
            -P ${CMAKE_CURRENT_SOURCE_DIR}/check-prestart.cmake
        COMMAND ${ROOT_SOURCE_DIR}/libraries/psibase/sdk/psibase-wasm-opt -O3
            VerifyR1-evaluated${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifyR1${suffix}.wasm
        BYPRODUCTS ${ROOT_BINARY_DIR}/VerifyR1${suffix}.wasm
    )
    psibase_schema(VerifyR1${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    # For a test only, never packaged: the same code without pre-initialization.
    # It grows its memory when it needs to, so it starts with what the linker gives it.
    add_executable(VerifyR1NotPreinitialized${suffix} src/VerifyR1.cpp)
    target_compile_definitions(VerifyR1NotPreinitialized${suffix} PRIVATE VERIFY_R1_NOT_PREINITIALIZED)
    target_mapped_include_directories(VerifyR1NotPreinitialized${suffix} PUBLIC include)
    target_link_libraries(VerifyR1NotPreinitialized${suffix} PUBLIC services_system${suffix} psibase-service${suffix})
    target_include_directories(VerifyR1NotPreinitialized${suffix} PUBLIC
        ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3
        ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3-internal)
    target_link_libraries(VerifyR1NotPreinitialized${suffix} PUBLIC -lbotan-3 exception-stub${suffix} -Wl,-z,stack-size=${VERIFY_R1_STACK})
    set_target_properties(VerifyR1NotPreinitialized${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
