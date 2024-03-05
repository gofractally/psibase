set(in ${CMAKE_CURRENT_SOURCE_DIR}/src/NopSys.wat)
set(out ${ROOT_BINARY_DIR}/NopSys.wasm)
add_custom_command(
    OUTPUT ${out}
    DEPENDS ${in}
    COMMAND wasm-as ${in} -o ${out}
)
add_custom_target(
    NopSys.wasm ALL DEPENDS ${out}
)
