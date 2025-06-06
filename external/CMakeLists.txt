include(ExternalProject)
include(ProcessorCount)

ProcessorCount(NUM_PROCS)

add_library(rapidjson INTERFACE)
target_mapped_include_directories(rapidjson INTERFACE rapidjson/include )

if(IS_WASM)
    install(DIRECTORY rapidjson/include/rapidjson TYPE INCLUDE COMPONENT libpsibase)
    install(FILES rapidjson/license.txt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/licenses RENAME LICENSE.rapidjson COMPONENT libpsibase)
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(FC_SUFFIX _debug)
endif()

if(IS_NATIVE)
    set(Boost_USE_MULTITHREADED ON)
    set(Boost_USE_STATIC_LIBS   ON)
    find_package(Boost 1.70 CONFIG REQUIRED COMPONENTS date_time filesystem chrono iostreams)

    option(ENABLE_INSTALL "enable this library to be installed" OFF)
    option(ENABLE_TOOLS "enable building of tools" OFF)
    # Hack to prevent softfloat from being installed
    set(PREV_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR})
    set(CMAKE_CURRENT_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/eos-vm/external)
    include(eos-vm/external/softfloat.cmake)
    set(CMAKE_CURRENT_SOURCE_DIR ${PREV_SOURCE_DIR})
    add_subdirectory(eos-vm)

endif()

ExternalProject_Add(catch2-ext
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/Catch2
    BINARY_DIR catch2
    TEST_EXCLUDE_FROM_MAIN 1
    EXCLUDE_FROM_ALL 1
    CMAKE_ARGS
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_TARGET_MESSAGES=${CMAKE_TARGET_MESSAGES}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/catch2
        -DCATCH_INSTALL_DOCS=FALSE
        -DCATCH_INSTALL_EXTRAS=FALSE
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
)

add_library(catch2 INTERFACE)
target_mapped_include_directories(catch2 INTERFACE ${CMAKE_BINARY_DIR}/catch2/include)
add_dependencies(catch2 catch2-ext)

if(IS_WASM)
    target_compile_options(catch2 INTERFACE -DCATCH_CONFIG_NO_POSIX_SIGNALS -DCATCH_CONFIG_DISABLE_EXCEPTIONS)
    install(DIRECTORY ${CMAKE_BINARY_DIR}/catch2/include/ TYPE INCLUDE COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/Catch2/LICENSE.txt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/licenses RENAME LICENSE.catch2 COMPONENT libpsibase)

endif()
