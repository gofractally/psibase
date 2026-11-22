enable_testing()

# PSIO (gofractally/psio) is psibase's serialization library. The native build
# acquires it at the commit pinned in cmake/PsibaseDependencies.cmake; guests
# use the headers of that same source tree.
if(DEFINED IS_NATIVE)
    include("${CMAKE_CURRENT_LIST_DIR}/../cmake/PsibaseDependencies.cmake")
    # PSIO fetches simdjson itself, at a pinned release and archive hash, unless
    # a simdjson::simdjson target already exists. Nothing else may provide one.
    if(TARGET simdjson::simdjson OR TARGET simdjson)
        message(FATAL_ERROR
            "A simdjson target exists before PSIO was acquired; psinode must link "
            "the simdjson release PSIO pins")
    endif()
    psibase_acquire_dependency(psio)
    # psibase links PSIO; it does not install PSIO's native package
    # (native/CMakeLists.txt sets PSIBASE_PSIO_EXCLUDE_FROM_ALL).
    get_property(psio_declaration GLOBAL PROPERTY _FetchContent_psio_savedDetails)
    if(NOT "EXCLUDE_FROM_ALL" IN_LIST psio_declaration)
        message(FATAL_ERROR "PSIO was declared without EXCLUDE_FROM_ALL; its install rules would "
            "be added to psibase's")
    endif()
    FetchContent_GetProperties(simdjson)
    if(NOT simdjson_POPULATED)
        message(FATAL_ERROR "PSIO did not fetch its pinned simdjson")
    endif()
    # The WASM guest project (an ExternalProject of the root) reads this.
    set(PSIBASE_PSIO_SOURCE_DIR "${psio_SOURCE_DIR}" CACHE INTERNAL
        "Source tree of the PSIO acquired by the native build")
endif()
if(DEFINED IS_WASM)
    # Guests are compiled by wasi-sdk with -fno-exceptions and use PSIO's
    # headers only: no simdjson (the hand-written JSON lexer), no exception
    # helpers. PSIO's own CMake project is not evaluated for the WASI toolchain.
    if(NOT PSIBASE_PSIO_SOURCE_DIR)
        set(PSIBASE_PSIO_SOURCE_DIR "${ROOT_SOURCE_DIR}/external/psio")
    endif()
    set(psio_cpp "${PSIBASE_PSIO_SOURCE_DIR}/cpp")
    if(NOT EXISTS "${psio_cpp}/include/psio/pssz.hpp")
        message(FATAL_ERROR
            "PSIO source is missing at ${PSIBASE_PSIO_SOURCE_DIR}; the native "
            "configure acquires it (cmake/PsibaseDependencies.cmake)")
    endif()
    add_library(psio INTERFACE)
    add_library(psio::psio ALIAS psio)
    target_include_directories(psio INTERFACE
        "${psio_cpp}/include" "${psio_cpp}/external/xxhash")
    target_compile_definitions(psio INTERFACE PSIO_EXCEPTIONS_ENABLED=0 PSIO_HAVE_SIMDJSON=0)
    target_compile_features(psio INTERFACE cxx_std_23)
    target_link_libraries(psio INTERFACE boost)
    # The SDK ships the same headers, laid out as PSIO's own install does.
    install(DIRECTORY "${psio_cpp}/include/psio" TYPE INCLUDE COMPONENT libpsibase)
    install(FILES "${psio_cpp}/external/xxhash/xxhash.h"
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/psio/external COMPONENT libpsibase)
endif()

add_subdirectory(psio1)
add_subdirectory(psibase)

if(DEFINED IS_NATIVE)
  add_subdirectory(psibase_http)
  add_subdirectory(net)
endif()
