set(in ${CMAKE_CURRENT_SOURCE_DIR}/src/Nop.wat)
set(out ${ROOT_BINARY_DIR}/Nop.wasm)
add_custom_command(
    OUTPUT ${out}
    DEPENDS ${in}
    COMMAND wasm-as ${in} -o ${out}
)
add_custom_target(
    Nop.wasm ALL DEPENDS ${out}
)

configure_file(src/Nop-schema.json ${ROOT_BINARY_DIR}/Nop-schema.json COPYONLY)
