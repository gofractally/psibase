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

function(add_wasm_test N)
endfunction()

function(native_and_wasm_test N)
    add_test(
        NAME n-${N}
        WORKING_DIRECTORY ${ROOT_BINARY_DIR}
        COMMAND ./${N}
    )
endfunction()

function(target_mapped_include_directories target type)
    target_include_directories(${target} ${type} ${ARGN})
endfunction()

set(Boost_USE_STATIC_LIBS ON)
find_package(Boost 1.72 REQUIRED COMPONENTS program_options)
add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${Boost_INCLUDE_DIR})
target_link_libraries(boost INTERFACE ${Boost_LIBRARIES})

add_subdirectory(../external external)
add_subdirectory(../libraries libraries)

add_subdirectory(../services services)
add_subdirectory(../programs programs)
