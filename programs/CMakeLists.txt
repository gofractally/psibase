if(DEFINED IS_NATIVE)
    add_subdirectory(psitest)
    add_subdirectory(psinode)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
