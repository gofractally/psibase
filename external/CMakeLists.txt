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

if(IS_WASM)
    find_package(Catch2 3 REQUIRED)
    add_library(catch2 INTERFACE)
    # --whole-archive is needed because wasi-sdk (as of version 24)
    # has a weak definition of __main_argc_argv that makes the linker
    # think that it doesn't need the one from libCatch2Main.a.
    target_link_libraries(catch2 INTERFACE -Wl,--whole-archive Catch2::Catch2WithMain -Wl,--no-whole-archive Catch2::Catch2)
else()
    add_subdirectory(Catch2)
endif()
