enable_testing()

add_test(
    NAME CargoPsibase-test
    COMMAND cargo test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/cargo-psibase/Cargo.toml
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/cargo-psibase/
)