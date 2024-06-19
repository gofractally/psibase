enable_testing()

add_test(
    NAME CargoPsibase-test
    COMMAND cargo test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/cargo-psibase/Cargo.toml
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/cargo-psibase/
)

add_test(
    NAME rs-subjective-test
    COMMAND ${CMAKE_CURRENT_BINARY_DIR}/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/test_subjective/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR} --psitest=${CMAKE_BINARY_DIR}/psitest
)
