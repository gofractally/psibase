enable_testing()

add_test(
    NAME rs-subjective-test
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_subjective/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-contract
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_contract_2/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-test-contract-2
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_contract_2/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-tests
    COMMAND cargo test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} -p test_fracpack -p psibase -p cargo-psibase
)

add_test(
    NAME rs-elections-test
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_subjective/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-sites-test
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_subjective/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)

add_test(
    NAME rs-build
    COMMAND cargo build --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}
)

include(ProcessorCount)
ProcessorCount(NPROC)
if(NPROC)
    set_tests_properties(rs-tests PROPERTIES PROCESSORS ${NPROC})
endif()
