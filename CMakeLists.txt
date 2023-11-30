cmake_minimum_required(VERSION 3.16.3)
cmake_policy(VERSION 3.16.3...3.25.1)
project(psibase)
include(ExternalProject)

if(CMAKE_BINARY_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    message(FATAL_ERROR "Building in-source is not supported; create a build dir and remove ${CMAKE_SOURCE_DIR}/CMakeCache.txt and ${CMAKE_SOURCE_DIR}/CMakeFiles")
endif()

if(NOT DEFINED WASI_SDK_PREFIX AND DEFINED ENV{WASI_SDK_PREFIX})
    set(WASI_SDK_PREFIX $ENV{WASI_SDK_PREFIX})
endif()

if(NOT DEFINED ICU_LIBRARY_DIR )
    set(ICU_LIBRARY_DIR $ENV{ICU_LIBRARY_DIR})
endif()


option (FORCE_COLORED_OUTPUT "Always produce ANSI-colored output (GNU/Clang only)." TRUE)
if (${FORCE_COLORED_OUTPUT})
    if ("${CMAKE_CXX_COMPILER_ID}" STREQUAL "GNU")
       add_compile_options (-fdiagnostics-color=always)
    else ()
       add_compile_options(-fcolor-diagnostics)
    endif ()
endif ()

file(WRITE ${CMAKE_BINARY_DIR}/CTestTestfile.cmake)

option(CLIO_ONLY "Only build clio" OFF)

option(BUILD_STATIC "Build static binaries" OFF)
option(ENABLE_SSL "Build psinode with TLS support" ON)

option(BUILD_NATIVE "Build native code" ON)
if(BUILD_NATIVE)
    add_subdirectory(native)
    file(APPEND ${CMAKE_BINARY_DIR}/CTestTestfile.cmake "subdirs(\"native\")\n")
endif()

option(BUILD_RELEASE_WASM "Build release wasms" ON)
option(BUILD_DEBUG_WASM "Build debug wasms" OFF)

include(GNUInstallDirs)

if(DEFINED WASI_SDK_PREFIX)
    install(DIRECTORY ${WASI_SDK_PREFIX}/ USE_SOURCE_PERMISSIONS DESTINATION . COMPONENT WASI EXCLUDE_FROM_ALL)
elseif(${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Linux")
    ExternalProject_Add(wasi-sdk
        URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz
        URL_HASH SHA256=7030139d495a19fbeccb9449150c2b1531e15d8fb74419872a719a7580aad0f9
        CONFIGURE_COMMAND ""
        BUILD_COMMAND ""
        INSTALL_COMMAND ""
    )
    ExternalProject_Get_Property(wasi-sdk SOURCE_DIR)
    set(WASI_SDK_PREFIX ${SOURCE_DIR})
    set(wasm-deps wasi-sdk)
    install(DIRECTORY ${WASI_SDK_PREFIX}/ USE_SOURCE_PERMISSIONS DESTINATION . COMPONENT WASI)
endif()

if(DEFINED WASI_SDK_PREFIX AND NOT CLIO_ONLY)
    ProcessorCount(NUM_PROCS)
    # This is used by the VerifySys service. The kinds of keys supported need to be configured
    # here.  We use a minimized build to keep the size of the service down. Static linking is
    # not enough because the algorithms are looked up dynamically.
    #
    # --cpu=generic is used instead of --cpu=wasm, because Botan thinks that wasm means emscripten.
    # --cc=gcc is used instead of clang, because Botan's clang configration includes -pthread.
    # The stack protector requires an entropy source so we can't support it.
    #  -msimd128 is disabled because binaryen 105 doesn't fully support it
    ExternalProject_Add(wasm-botan
        URL https://github.com/gofractally/psibase/releases/download/deps/Botan-3.1.1.tar.xz
        URL_HASH SHA256=30c84fe919936a98fef5331f246c62aa2c0e4d2085b2d4511207f6a20afa3a6b
        DEPENDS ${wasm-deps}
        PREFIX ${CMAKE_CURRENT_BINARY_DIR}/wasm/botan
        INSTALL_DIR ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps
        CONFIGURE_COMMAND <SOURCE_DIR>/configure.py --cc-bin=${WASI_SDK_PREFIX}/bin/clang++ --cc=gcc --cpu=generic --os=none --ar-command=${WASI_SDK_PREFIX}/bin/llvm-ar --build-targets=static --with-sysroot-dir=${WASI_SDK_PREFIX}/share/wasi-sysroot --minimized-build --enable-modules=ecdsa,raw_hash "--cxxflags=--target=wasm32-wasi -O3 -msign-ext -mnontrapping-fptoint -mbulk-memory" --without-stack-protector --prefix=<INSTALL_DIR>
        BUILD_COMMAND make -j${NUM_PROCS}
        INSTALL_COMMAND make install
    )
    ExternalProject_Add(wasm
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/wasm
        DEPENDS ${wasm-deps} wasm-botan
        BINARY_DIR wasm
        INSTALL_COMMAND ""
        BUILD_ALWAYS 1
        TEST_EXCLUDE_FROM_MAIN 1
        STEP_TARGETS configure
        CMAKE_ARGS
            -DCMAKE_BUILD_TYPE=
            -DBUILD_RELEASE_WASM=${BUILD_RELEASE_WASM}
            -DBUILD_DEBUG_WASM=${BUILD_DEBUG_WASM}
            -DCMAKE_TARGET_MESSAGES=${CMAKE_TARGET_MESSAGES}
            -DCMAKE_TOOLCHAIN_FILE=${CMAKE_CURRENT_SOURCE_DIR}/wasm/toolchain.cmake
            -DWASI_SDK_PREFIX=${WASI_SDK_PREFIX}
            -DWASM_CLANG_PREFIX=${WASM_CLANG_PREFIX}
            -DWASM_CLANG_SUFFIX=${WASM_CLANG_SUFFIX}
            -DCMAKE_SYSROOT=${WASI_SDK_PREFIX}/share/wasi-sysroot
            -DFORCE_COLORED_OUTPUT=${FORCE_COLORED_OUTPUT}
            -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
            -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
            -DCMAKE_FIND_ROOT_PATH=${CMAKE_CURRENT_BINARY_DIR}/wasm/deps
            -DCMAKE_PREFIX_PATH=/
            -DCMAKE_INSTALL_PREFIX=${CMAKE_INSTALL_PREFIX}
            -DCMAKE_INSTALL_INCLUDEDIR=${CMAKE_INSTALL_DATADIR}/wasi-sysroot/include
            -DCMAKE_INSTALL_LIBDIR=${CMAKE_INSTALL_DATADIR}/wasi-sysroot/lib
    )
    file(APPEND ${CMAKE_BINARY_DIR}/CTestTestfile.cmake "subdirs(\"wasm\")\n")
    ExternalProject_Add_StepTargets(wasm test)
    install(CODE "include(${CMAKE_CURRENT_BINARY_DIR}/wasm/cmake_install.cmake)" COMPONENT libpsibase)
else()
    message(WARNING "WASI_SDK_PREFIX isn't defined; skipping wasm")
endif()

option(BUILD_DOC "Build doc" OFF)
if(BUILD_DOC)
    set(DOC_DEP doc)
    ExternalProject_Add(
        gen-cpp-doc
        DEPENDS             wasm
        SOURCE_DIR          ${CMAKE_CURRENT_SOURCE_DIR}/rust
        CONFIGURE_COMMAND   ""
        BUILD_COMMAND       cargo build -r --bin gen-cpp-doc --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/rust/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
        INSTALL_COMMAND     ""
    )
    ExternalProject_Add(
        md2man
        SOURCE_DIR          ${CMAKE_CURRENT_SOURCE_DIR}/rust
        CONFIGURE_COMMAND   ""
        BUILD_COMMAND       cargo build -r --bin md2man --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/rust/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
        INSTALL_COMMAND     ""
    )
    
    function(ADD_BOOK_FILES path extension)
        file(COPY ${CMAKE_CURRENT_SOURCE_DIR}${path} DESTINATION ${CMAKE_CURRENT_BINARY_DIR}${path})
        file(GLOB DOC_FILES ${CMAKE_CURRENT_BINARY_DIR}${path}*.${extension})
        set(doc-src ${doc-src} ${DOC_FILES} PARENT_SCOPE)
    endfunction()
    
    configure_file(doc/psidk/book.toml.in doc/psidk/book.toml)
    configure_file(doc/psidk/theme/index.hbs doc/psidk/theme/index.hbs)
    ADD_BOOK_FILES("/doc/psidk/theme/js/" "js")
    ADD_BOOK_FILES("/doc/psidk/theme/css/" "css")
    ADD_BOOK_FILES("/doc/psidk/src/_img/" "svg")
    
    file(GLOB_RECURSE doc-src ${CMAKE_CURRENT_SOURCE_DIR}/doc/psidk/src/*.md)
    list(APPEND doc-src ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/book.toml)   
    
    file(GLOB_RECURSE doc-cpp ${CMAKE_CURRENT_SOURCE_DIR}/doc/src/development/services/cpp-service/*.cpp)
    file(GLOB_RECURSE doc-cmake doc/src/development/services/cpp-service/*/CMakeLists.txt)
    file(GLOB doc-headers libraries/psibase/common/include/psibase/*.hpp)
    file(GLOB doc-service-headers services/*/*/include/services/*/*.hpp)
    add_custom_command(
        OUTPUT doc/psidk/book/index.html
        DEPENDS gen-cpp-doc ${doc-src} ${doc-cpp} ${doc-cmake} ${doc-headers} ${doc-service-headers}
        COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/doc/psidk && rm -rf ${CMAKE_CURRENT_BINARY_DIR}/book && mdbook build -d ${CMAKE_CURRENT_BINARY_DIR}/book ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk
    )
    add_custom_target(
        ${DOC_DEP}
        DEPENDS doc/psidk/book/index.html
    )
    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psinode.1
        DEPENDS md2man doc/psidk/src/run-infrastructure/cli/psinode.md
        COMMAND ${CMAKE_CURRENT_BINARY_DIR}/rust/release/md2man < ${CMAKE_CURRENT_SOURCE_DIR}/doc/psidk/src/run-infrastructure/cli/psinode.md > ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psinode.1
    )
    add_custom_target(psinode.1 ALL DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psinode.1)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psinode.1 TYPE MAN COMPONENT ServerData)
    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psibase.1
        DEPENDS md2man doc/psidk/src/run-infrastructure/cli/psibase.md
        COMMAND ${CMAKE_CURRENT_BINARY_DIR}/rust/release/md2man < ${CMAKE_CURRENT_SOURCE_DIR}/doc/psidk/src/run-infrastructure/cli/psibase.md > ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psibase.1
    )
    add_custom_target(psibase.1 ALL DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psibase.1)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk/psibase.1 TYPE MAN COMPONENT Client)
endif()

set(JS_DIRS
    services/system/AccountSys/ui:AccountSys_js
    services/user/PsiSpaceSys/ui:PsiSpaceSys_js
    services/user/CommonSys/ui:CommonSys_js
    services/user/TokenSys/ui:TokenSys_js
    services/user/ExploreSys/ui:ExploreSys_js
    services/user/InviteSys/ui:InviteSys_js
)
set(ADMIN_DIR services/user/AdminSys/ui:AdminSys_js)
set(COMMON_DIR services/user/CommonSys/common-lib/:CommonSysLib_js)

function(add_js_target ENTRY OUTPUT_FILE)
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${ENTRY})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 DEP ${ENTRY})

    file(GLOB_RECURSE sources ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/src/*)
    set(DEPENDENCIES ${sources} ${ARGN})
    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/dist/${OUTPUT_FILE}
        DEPENDS ${DEPENDENCIES}
        COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/${PATH} && yarn --mutex network && yarn build
    )
    add_custom_target(
        ${DEP}
        DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/dist/${OUTPUT_FILE}
    )
endfunction()

option(BUILD_JS "Build JS" ON)
if(BUILD_JS)
    list(TRANSFORM JS_DIRS REPLACE "^[^:]+:([^:]+)$" \\1 OUTPUT_VARIABLE JS_DEPS)
    file(GLOB common LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/common/*)
    file(GLOB common-fonts LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/common/fonts/*)

    # Builds the Common Sys Lib
    add_js_target(${COMMON_DIR} common-lib.js)

    foreach(ENTRY ${JS_DIRS})
        add_js_target(${ENTRY} index.html ${common} ${common-fonts} CommonSysLib_js)
    endforeach()

    set(WASM_PSIBASE_BYPRODUCTS
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase/wasm-psibase_bg.js
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase/wasm-psibase_bg.wasm
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase/wasm-psibase_bg.wasm.d.ts
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase/wasm-psibase.d.ts
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase/wasm-psibase.js
    )
    add_js_target(${ADMIN_DIR} index.html ${WASM_PSIBASE_BYPRODUCTS})
    add_custom_command(
        OUTPUT ${WASM_PSIBASE_BYPRODUCTS}
        DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase
        COMMAND wasm-pack build ${CMAKE_CURRENT_SOURCE_DIR}/rust/psibase --out-dir ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/wasm-psibase --out-name wasm-psibase
    )
    add_custom_target(wasm-psibase ALL DEPENDS ${WASM_PSIBASE_BYPRODUCTS})
    add_dependencies(wasm-psibase rust)

    function(psinode_files target pfx)
    add_custom_target(
    ${target}
    ALL
    DEPENDS AdminSys_js
    COMMAND rm -rf ${pfx}/share/psibase/services/admin-sys
    COMMAND mkdir -p ${pfx}/share/psibase/services/admin-sys/common
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/AdminSys/ui/dist ${pfx}/share/psibase/services/admin-sys
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/common/fonts ${pfx}/share/psibase/services/admin-sys/common/fonts
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/common/rpc.mjs ${pfx}/share/psibase/services/admin-sys/common/
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/common/keyConversions.mjs ${pfx}/share/psibase/services/admin-sys/common/
    COMMAND cp ${CMAKE_CURRENT_SOURCE_DIR}/programs/psinode/config.in ${pfx}/share/psibase/config.in
    )
    endfunction()

    psinode_files(psinode-share ${CMAKE_CURRENT_BINARY_DIR})
    add_dependencies(AdminSys_js wasm-psibase)

    include(GNUInstallDirs)
    install(DIRECTORY services/user/AdminSys/ui/dist/ DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/admin-sys COMPONENT ServerData)
    install(DIRECTORY services/user/CommonSys/common/fonts DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/admin-sys/common COMPONENT ServerData)
    install(FILES services/user/CommonSys/common/rpc.mjs services/user/CommonSys/common/keyConversions.mjs DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/admin-sys/common COMPONENT ServerData)
endif()

option(BUILD_RUST "Build rust" ON)
if(BUILD_RUST)
    set(BOOT_IMAGE ${CMAKE_CURRENT_SOURCE_DIR}/rust/psibase/boot-image/contents/)
    set(COMMON_SYS ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys)
    set(THIRD_SRC ${COMMON_SYS}/common/thirdParty/src)
    set(THIRD_DEST ${BOOT_IMAGE}/CommonSys/common/thirdParty)
    ExternalProject_Add(
        rust
        DEPENDS wasm ${DOC_DEP} ${JS_DEPS}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/rust
        BUILD_BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase
        CONFIGURE_COMMAND ""
        BUILD_COMMAND   rm -rf ${BOOT_IMAGE}
        COMMAND         mkdir -p ${BOOT_IMAGE}/CommonSys/common ${BOOT_IMAGE}/CommonSys/common/fonts ${BOOT_IMAGE}/CommonSys/ui/vanilla
        COMMAND         mkdir -p ${BOOT_IMAGE}/AccountSys/ui ${BOOT_IMAGE}/ExploreSys/ui
        COMMAND         mkdir -p ${BOOT_IMAGE}/AuthSys
        COMMAND         mkdir -p ${BOOT_IMAGE}/AuthEcSys ${BOOT_IMAGE}/TokenSys/ui ${BOOT_IMAGE}/PsiSpaceSys/ui
        COMMAND         mkdir -p ${BOOT_IMAGE}/InviteSys/ui
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/AccountSys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/AuthEcSys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/AuthSys.wasm                      ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/AuthAnySys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/AuthInviteSys.wasm                ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/CommonSys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/CoreFractalSys.wasm               ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/CpuSys.wasm                       ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/DocSys.wasm                       ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/ExploreSys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/FractalSys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/InviteSys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/NftSys.wasm                       ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/ProducerSys.wasm                  ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/ProxySys.wasm                     ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/PsiSpaceSys.wasm                  ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RAccountSys.wasm                  ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RAuthEcSys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RAuthSys.wasm                     ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RProducerSys.wasm                 ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RProxySys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/RTokenSys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/SetCodeSys.wasm                   ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/SymbolSys.wasm                    ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/TokenSys.wasm                     ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/TransactionSys.wasm               ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/VerifyEcSys.wasm                  ${BOOT_IMAGE}
        COMMAND         cp -a ${CMAKE_CURRENT_BINARY_DIR}/VerifySys.wasm                    ${BOOT_IMAGE}

        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/system/AccountSys/ui/dist    ${BOOT_IMAGE}/AccountSys/ui/dist
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/system/AuthEcSys/ui          ${BOOT_IMAGE}/AuthEcSys/ui
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/system/AuthSys/ui            ${BOOT_IMAGE}/AuthSys/ui
        COMMAND         bash -c "cp -a ${COMMON_SYS}/common-lib/dist/common-lib.js  ${BOOT_IMAGE}/CommonSys/common/common-lib.js"
        COMMAND         bash -c "cp -a ${COMMON_SYS}/common/*.mjs                               ${BOOT_IMAGE}/CommonSys/common/"
        COMMAND         bash -c "cp -a ${COMMON_SYS}/common/fonts/*                             ${BOOT_IMAGE}/CommonSys/common/fonts/"
        COMMAND         cp -a ${COMMON_SYS}/ui/vanilla/common.index.html                        ${BOOT_IMAGE}/CommonSys/ui/vanilla
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonSys/ui/dist       ${BOOT_IMAGE}/CommonSys/ui/dist
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/ExploreSys/ui/dist      ${BOOT_IMAGE}/ExploreSys/ui/dist
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/TokenSys/ui/dist        ${BOOT_IMAGE}/TokenSys/ui/dist
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/PsiSpaceSys/ui/dist     ${BOOT_IMAGE}/PsiSpaceSys/ui/dist
        COMMAND         cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/InviteSys/ui/dist       ${BOOT_IMAGE}/InviteSys/ui/dist

        COMMAND         bash -c "cp -a ${CMAKE_CURRENT_BINARY_DIR}/book                     ${BOOT_IMAGE}/doc 2>/dev/null || mkdir -p ${BOOT_IMAGE}/doc"

        COMMAND         rm -rf ${THIRD_DEST}
        COMMAND         mkdir -p ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/htm.module.js                                    ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/iframeResizer.contentWindow.js                   ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/iframeResizer.js                                 ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/react-dom.development.js                         ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/react-dom.production.min.js                      ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/react-router-dom.min.js                          ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/react.development.js                             ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/react.production.min.js                          ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/semantic-ui-react.min.js                         ${THIRD_DEST}
        COMMAND         cp -a ${THIRD_SRC}/useLocalStorageState.js                          ${THIRD_DEST}

        COMMAND         cargo build -r --bin psibase --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/rust/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
        INSTALL_COMMAND ""
    )
    install(PROGRAMS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase TYPE BIN COMPONENT Client)
endif()

option(BUILD_EXAMPLES "Build examples" ON)
if(BUILD_EXAMPLES)
    add_subdirectory(doc/psidk/src/development/services/cpp-service doc-examples)
endif()

include(CPackComponent)
cpack_add_component_group(Server DESCRIPTION "The psinode server")
cpack_add_component(ServerBin GROUP Server HIDDEN)
cpack_add_component(ServerData GROUP Server HIDDEN)
cpack_add_component(Client DESCRIPTION "The psibase client")
cpack_add_component_group(SDK DESCRIPTION "SDK for developing psibase services")
cpack_add_component(Tester GROUP SDK)
cpack_add_component(WASI GROUP SDK)
cpack_add_component(libpsibase GROUP SDK)

set(CPACK_PACKAGE_NAME psidk)
set(CPACK_PACKAGE_VENDOR "Fractally, LLC")
set(CPACK_PACKAGE_DESCRIPTION)
set(CPACK_PACKAGE_HOMEPAGE_URL https://about.psibase.io)
set(CPACK_GENERATOR TGZ)
include(CPack)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
