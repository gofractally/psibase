include(ExternalProject)
include(ProcessorCount)

ProcessorCount(NUM_PROCS)

add_subdirectory( simdjson )

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
    find_package(Boost 1.67 REQUIRED COMPONENTS date_time filesystem chrono iostreams)

    if(NOT CLIO_ONLY)
        option(ENABLE_INSTALL "enable this library to be installed" OFF)
        option(ENABLE_TOOLS "enable building of tools" OFF)
        # Hack to prevent softfloat from being installed
        set(PREV_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR})
        set(CMAKE_CURRENT_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/eos-vm/external)
        include(eos-vm/external/softfloat.cmake)
        set(CMAKE_CURRENT_SOURCE_DIR ${PREV_SOURCE_DIR})
        add_subdirectory(eos-vm)

        # set(MDBX_OUTPUT_DIR ${ROOT_BINARY_DIR}/mdbx)
        # set(MDBX_BUILD_TIMESTAMP unknown)
        # add_subdirectory(libmdbx)
    endif()
endif()

ExternalProject_Add(fmt-ext
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/fmt
    BINARY_DIR fmt
    TEST_EXCLUDE_FROM_MAIN 1
    EXCLUDE_FROM_ALL 1
    CMAKE_ARGS
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_TARGET_MESSAGES=${CMAKE_TARGET_MESSAGES}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/fmt
        -DCMAKE_INSTALL_LIBDIR=lib
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
    BUILD_BYPRODUCTS ${CMAKE_BINARY_DIR}/fmt/lib/libfmt.a
)

add_library(fmt INTERFACE)
target_mapped_include_directories(fmt INTERFACE ${CMAKE_BINARY_DIR}/fmt/include)
target_link_libraries(fmt INTERFACE ${CMAKE_BINARY_DIR}/fmt/lib/libfmt.a)
add_dependencies(fmt fmt-ext)

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

    # TODO: copy simdjson license to clsdk/licenses
    # TODO: debug vs release builds
    install(DIRECTORY simdjson/include/ TYPE INCLUDE COMPONENT libpsibase)
    install(TARGETS simdjson ARCHIVE COMPONENT libpsibase)
endif()

if(NOT IS_WASM)
  ExternalProject_Add(secp256k1-ext
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/secp256k1
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/secp256k1
    EXCLUDE_FROM_ALL 1
    CONFIGURE_COMMAND
            cp -a ${CMAKE_CURRENT_SOURCE_DIR}/secp256k1 ${CMAKE_CURRENT_BINARY_DIR}/secp256k1-build
            && cd ${CMAKE_CURRENT_BINARY_DIR}/secp256k1-build
            && ./autogen.sh
            && export "CC=${CMAKE_C_COMPILER_LAUNCHER} ${CMAKE_C_COMPILER}"
            && export AR=${CMAKE_AR}
            && export RANLIB=${CMAKE_RANLIB}
            && ./configure --prefix=${CMAKE_CURRENT_BINARY_DIR}/secp256k1
     BUILD_BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/secp256k1/lib/libsecp256k1.a
     BUILD_COMMAND cd ../secp256k1-build && make
     INSTALL_COMMAND cd ../secp256k1-build && make install
  )
  add_library(secp256k1 INTERFACE)
  target_include_directories(secp256k1 INTERFACE ${CMAKE_CURRENT_BINARY_DIR}/secp256k1/include)
  target_link_libraries(secp256k1 INTERFACE ${CMAKE_CURRENT_BINARY_DIR}/secp256k1/lib/libsecp256k1.a)
  add_dependencies(secp256k1 secp256k1-ext)
endif()
