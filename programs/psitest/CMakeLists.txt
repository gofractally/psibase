find_package(Boost 1.67 REQUIRED COMPONENTS filesystem)

add_executable(psitest main.cpp)
target_link_libraries(psitest psibase abieos debug_eos_vm ${Boost_LIBRARIES})
set_target_properties(psitest PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
add_custom_command(TARGET psitest POST_BUILD
    COMMAND mkdir -p ${ROOT_BINARY_DIR}/psidk/bin
    COMMAND cp -a $<TARGET_FILE:psitest> ${ROOT_BINARY_DIR}/psidk/bin
)

# TODO: find out why this is necessary. Without this,
# psitest, when compiled with gcc, produces
# "longjmp causes uninitialized stack frame"
# when the --subst option is used.
target_compile_options(psitest PRIVATE -D_FORTIFY_SOURCE=0)
