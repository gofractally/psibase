function(build_example name)
    ExternalProject_Add(
        ${name}
        DEPENDS wasm
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/${name}
        CONFIGURE_COMMAND WASI_SDK_PREFIX=${WASI_SDK_PREFIX} bash -c "cmake `${CMAKE_CURRENT_BINARY_DIR}/../psidk/bin/psidk-cmake-args` ${CMAKE_CURRENT_SOURCE_DIR}/${name}"
        BUILD_COMMAND cmake --build .
        INSTALL_COMMAND ""
    )
endfunction()

build_example(basic)
build_example(calling)
build_example(minimal-ui)
