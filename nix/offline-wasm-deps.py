"""Rewrite CMake download helpers to copy prefetched tarballs."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"{path}: expected block not found")
    path.write_text(text.replace(old, new, 1))


replace_once(
    Path("wasm/CMakeLists.txt"),
    """function(download url archive hash)
    if(NOT EXISTS ${archive})
        message("Downloading ${url}")
        file(DOWNLOAD ${url} ${archive}
            STATUS download_status
            EXPECTED_HASH SHA256=${hash}
            TIMEOUT 600
            SHOW_PROGRESS
            TLS_VERIFY ON)
        list(POP_BACK download_status BOOST_DOWNLOAD_STATUS_MSG)
        if(NOT download_status EQUAL 0)
            file(REMOVE ${archive})
            message(FATAL_ERROR "Download ${url} failed. ${BOOST_DOWNLOAD_STATUS_MSG}")
        endif()
    endif()
endfunction()""",
    """function(download url archive hash)
    if(NOT EXISTS ${archive})
        message("Copying prefetched ${url}")
        get_filename_component(_dir ${archive} DIRECTORY)
        file(MAKE_DIRECTORY ${_dir})
        file(COPY_FILE ${url} ${archive})
    endif()
endfunction()""",
)

replace_once(
    Path("CMakeLists.txt"),
    """    ExternalProject_Add(wasm
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/wasm""",
    """    ExternalProject_Add(wasm
        CMAKE_GENERATOR "Unix Makefiles"
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/wasm""",
)

replace_once(
    Path("libraries/psibase/sdk/pack_service.cmake"),
    "COMMAND ${PSITEST_EXECUTABLE} $<TARGET_FILE:${target}-schema-gen> --schema > ${_OUTFILE}",
    "COMMAND wasm-opt -O1 --disable-reference-types --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --enable-simd $<TARGET_FILE:${target}-schema-gen> -o ${CMAKE_CURRENT_BINARY_DIR}/${target}-schema-gen.opt.wasm\n        COMMAND ${PSITEST_EXECUTABLE} ${CMAKE_CURRENT_BINARY_DIR}/${target}-schema-gen.opt.wasm --schema > ${_OUTFILE}",
)

# Prefetched JS is copied into thirdParty/src; skip ExternalProject URL fetch.
replace_once(
    Path("packages/CMakeLists.txt"),
    """function(downloadThirdParty depName depUrl)
    ExternalProject_Add(
        ${depName}
        PREFIX ${CMAKE_CURRENT_SOURCE_DIR}/common/resources/thirdParty
        URL ${depUrl}
        DOWNLOAD_NO_EXTRACT 1
        CONFIGURE_COMMAND ""
        BUILD_COMMAND ""
        INSTALL_COMMAND ""
        )
endfunction(downloadThirdParty)""",
    """function(downloadThirdParty depName depUrl)
endfunction(downloadThirdParty)""",
)

# Runtime package does not need native unit tests / fuzz binaries.
replace_once(
    Path("libraries/psio/CMakeLists.txt"),
    "add_subdirectory(tests)",
    "if(BUILD_TESTING)\nadd_subdirectory(tests)\nendif()",
)
replace_once(
    Path("libraries/triedent/CMakeLists.txt"),
    "add_subdirectory(test)",
    "if(BUILD_TESTING)\nadd_subdirectory(test)\nendif()",
)
replace_once(
    Path("libraries/net/CMakeLists.txt"),
    """if(DEFINED IS_NATIVE)
  add_subdirectory(test)
endif()""",
    """if(DEFINED IS_NATIVE AND BUILD_TESTING)
  add_subdirectory(test)
endif()""",
)
replace_once(
    Path("libraries/psibase/CMakeLists.txt"),
    """        add_subdirectory(native/tests)
        add_subdirectory(common/tests)""",
    """        if(BUILD_TESTING)
        add_subdirectory(native/tests)
        add_subdirectory(common/tests)
        endif()""",
)
replace_once(
    Path("doc/book.toml.in"),
    'command = "/usr/bin/env WASI_SDK_PREFIX=${WASI_SDK_PREFIX}',
    'command = "env WASI_SDK_PREFIX=${WASI_SDK_PREFIX}',
)

replace_once(
    Path("wasm/boost/CMakeLists.txt"),
    """if(NOT EXISTS ${BOOST_ARCHIVE})
    message("Downloading ${BOOST_URL}")
    file(DOWNLOAD ${BOOST_URL} ${BOOST_ARCHIVE}
        STATUS BOOST_DOWNLOAD_STATUS
        TIMEOUT 600
        SHOW_PROGRESS
        EXPECTED_HASH SHA256=${BOOST_SHA256}
        TLS_VERIFY ON)
    list(POP_BACK BOOST_DOWNLOAD_STATUS BOOST_DOWNLOAD_STATUS_MSG)
    if(NOT BOOST_DOWNLOAD_STATUS EQUAL 0)
        file(REMOVE ${BOOST_ARCHIVE})
        message(FATAL_ERROR "Download ${BOOST_URL} failed. ${BOOST_DOWNLOAD_STATUS_MSG}")
    endif()
endif()""",
    """if(NOT EXISTS ${BOOST_ARCHIVE})
    message("Copying prefetched ${BOOST_URL}")
    get_filename_component(_bdir ${BOOST_ARCHIVE} DIRECTORY)
    file(MAKE_DIRECTORY ${_bdir})
    file(COPY_FILE ${BOOST_URL} ${BOOST_ARCHIVE})
endif()""",
)
