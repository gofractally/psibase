find_package(Boost 1.75 REQUIRED COMPONENTS filesystem)

add_executable(psitest main.cpp)

if(APPLE)
    target_link_libraries(psitest
        psibase
        debug_eos_vm
        ${Boost_LIBRARIES}
    )
elseif(UNIX)
    target_link_libraries(psitest
        psibase
        debug_eos_vm
        ${Boost_LIBRARIES}
        -static-libgcc
        -static-libstdc++
    )
endif()

set_target_properties(psitest PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

install(TARGETS psitest RUNTIME COMPONENT Tester)

configure_file(psitest-gdb.py ${ROOT_BINARY_DIR}/psitest-gdb.py COPYONLY)

include(GNUInstallDirs)
install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/psitest-gdb.py DESTINATION ${CMAKE_INSTALL_LIBDIR}/debug COMPONENT Tester)
# TODO: find out why this is necessary. Without this,
# psitest, when compiled with gcc, produces
# "longjmp causes uninitialized stack frame"
# when the --subst option is used.
# target_compile_options(psitest PRIVATE -D_FORTIFY_SOURCE=0)
