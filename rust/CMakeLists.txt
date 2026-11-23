enable_testing()

add_test(
    NAME rs-test-psibase-macros
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_psibase_macros/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-subjective-test
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_subjective/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-contract
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_contract/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-contract-2
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_contract_2/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-package
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_package/service/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-panic
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_panic/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

# The PKCS #11 signer test in the psibase crate needs a token; it uses SoftHSM
# when that is installed and skips itself otherwise. These are the cache
# variables the psinode tests use, so -DLIBSOFTHSM2=... applies to both.
find_library(LIBSOFTHSM2 libsofthsm2.so PATH_SUFFIXES softhsm)
find_program(SOFTHSM2_UTIL softhsm2-util)
set(rs_tests_softhsm)
if(LIBSOFTHSM2 AND SOFTHSM2_UTIL)
    set(rs_tests_softhsm PSIBASE_TEST_SOFTHSM2=${LIBSOFTHSM2} PSIBASE_TEST_SOFTHSM2_UTIL=${SOFTHSM2_UTIL})
endif()
add_test(
    NAME rs-tests
    COMMAND env PSIBASE_DATADIR=${CMAKE_BINARY_DIR}/share/psibase ${rs_tests_softhsm} cargo test -r --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} -p psibase -p cargo-psibase -p psibase-macros-lib -p psibase-macros-derive -p psibase_plugin
)

# Unit tests of the browser signing plugin, run natively.
add_test(
    NAME plugin-web-crypto-tests
    COMMAND cargo test -r --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/../packages/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/plugin-tests -p web-crypto
)

include(ProcessorCount)
ProcessorCount(NPROC)
if(NPROC)
    set_tests_properties(rs-tests plugin-web-crypto-tests PROPERTIES PROCESSORS ${NPROC})
endif()
