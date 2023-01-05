cmake_minimum_required(VERSION 3.6.0)

if(NOT DEFINED WASI_SDK_PREFIX AND DEFINED ENV{WASI_SDK_PREFIX})
    set(WASI_SDK_PREFIX $ENV{WASI_SDK_PREFIX})
endif()

if(NOT DEFINED WASI_SDK_PREFIX AND EXISTS ${CMAKE_CURRENT_LIST_DIR}/../../wasi-sysroot)
    find_program(clang-location
        NAME clang++
        PATHS ${CMAKE_CURRENT_LIST_DIR}/../../../bin /opt/wasi-sdk/bin
        NO_CACHE
        NO_DEFAULT_PATH
    )
    if(clang-location)
        get_filename_component(wasi-bin ${clang-location} DIRECTORY)
        get_filename_component(WASI_SDK_PREFIX ${wasi-bin}/.. REALPATH)
        set(WASI_SDK_PREFIX ${WASI_SDK_PREFIX} CACHE PATH "The location of the WASI SDK")
    endif()
endif()

if(NOT DEFINED WASI_SDK_PREFIX)
    message(FATAL_ERROR "WASI_SDK_PREFIX is not defined")
endif()

set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(triple wasm32-wasi)
set(CMAKE_EXECUTABLE_SUFFIX_C .wasm)
set(CMAKE_EXECUTABLE_SUFFIX_CXX .wasm)

set(CMAKE_SYSROOT ${WASI_SDK_PREFIX}/share/wasi-sysroot)

set(CMAKE_C_COMPILER ${WASI_SDK_PREFIX}/bin/clang)
set(CMAKE_CXX_COMPILER ${WASI_SDK_PREFIX}/bin/clang++)
set(CMAKE_AR ${WASI_SDK_PREFIX}/bin/llvm-ar)
set(CMAKE_RANLIB ${WASI_SDK_PREFIX}/bin/llvm-ranlib)
set(CMAKE_C_COMPILER_TARGET ${triple})
set(CMAKE_CXX_COMPILER_TARGET ${triple})

set(CMAKE_TRY_COMPILE_PLATFORM_VARIABLES WASI_SDK_PREFIX)

if(NOT __psibase_toolchain_included)
    set(__psibase_toolchain_included 1)
    string(APPEND CMAKE_C_FLAGS_DEBUG_INIT " -ggdb")
    string(APPEND CMAKE_CXX_FLAGS_DEBUG_INIT " -ggdb")
    string(APPEND CMAKE_C_FLAGS_RELWITHDEBINFO_INIT " -ggdb")
    string(APPEND CMAKE_CXX_FLAGS_RELWITHDEBINFO_INIT " -ggdb")
    string(APPEND CMAKE_EXE_LINKER_FLAGS_RELEASE_INIT "-Wl,--strip-all -O3")
    string(APPEND CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO_INIT "-O3")
    string(APPEND CMAKE_EXE_LINKER_FLAGS_MINSIZEREL_INIT "-Wl,--strip-all -Os")
endif()

if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/../../wasi-sysroot)
    # Installed psidk
    get_filename_component(root ${CMAKE_CURRENT_LIST_DIR}/../.. REALPATH)
    list(APPEND CMAKE_MODULE_PATH ${root}/wasi-sysroot/share/cmake/Modules)
    set(CMAKE_FIND_ROOT_PATH ${root}/wasi-sysroot)
elseif(EXISTS ${CMAKE_CURRENT_LIST_DIR}/wasm/deps)
    # Build directory
    list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_LIST_DIR}/cmake)
    set(CMAKE_FIND_ROOT_PATH ${CMAKE_CURRENT_LIST_DIR})
endif()
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
