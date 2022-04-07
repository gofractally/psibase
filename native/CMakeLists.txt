enable_testing()

set(IS_NATIVE YES)
set(ROOT_SOURCE_DIR ${CMAKE_SOURCE_DIR})
set(ROOT_BINARY_DIR ${CMAKE_BINARY_DIR})

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)

option(FORCE_COLORED_OUTPUT "Always produce colored output" TRUE)
if(${FORCE_COLORED_OUTPUT})
    if("${CMAKE_CXX_COMPILER_ID}" STREQUAL "GNU")
       add_compile_options(-fdiagnostics-color=always)
    elseif("${CMAKE_CXX_COMPILER_ID}" STREQUAL "Clang")
       add_compile_options(-fcolor-diagnostics)
    endif()
endif()

function(native_test N)
    add_test(
        NAME n-${N}
        WORKING_DIRECTORY ${ROOT_BINARY_DIR}
        COMMAND ./${N}
    )
endfunction()

function(native_and_wasm_test N)
    add_test(
        NAME n-${N}
        WORKING_DIRECTORY ${ROOT_BINARY_DIR}
        COMMAND ./${N}
    )
endfunction()

find_package(Boost 1.40 REQUIRED)
add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${Boost_INCLUDE_DIR})
target_link_libraries(boost INTERFACE ${Boost_LIBRARIES})

add_subdirectory(../external external)
add_subdirectory(../libraries libraries)

if(NOT CLIO_ONLY)
    add_subdirectory(../contracts contracts)
    add_subdirectory(../programs programs)
endif()
