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

option(BUILD_STATIC "Build static binaries" OFF)
option(ENABLE_SSL "Build psinode with TLS support" ON)

add_subdirectory(native)
add_subdirectory(rust)
file(APPEND ${CMAKE_BINARY_DIR}/CTestTestfile.cmake "subdirs(\"native\", \"rust\")\n")

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

if(DEFINED WASI_SDK_PREFIX)
    ProcessorCount(NUM_PROCS)
    # This is used by the VerifySig service. The kinds of keys supported need to be configured
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
            -DBUILD_RELEASE_WASM=ON
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
        BUILD_BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/Accounts.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/AuthDelegate.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/AuthK1.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/AuthSig.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/AuthAny.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/AuthInvite.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/CommonApi.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/CoreFractal.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/CpuLimit.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Explorer.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Fractal.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Invite.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Nft.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Nop.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Packages.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Producers.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/HttpServer.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Sites.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RAccounts.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RAuthK1.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RAuthSig.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RPackages.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RProducers.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RHttpServer.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/RTokenSys.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/SetCode.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/SymbolSys.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/TokenSys.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/Transact.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/VerifyK1.wasm
                         ${CMAKE_CURRENT_BINARY_DIR}/VerifySig.wasm
    )
    file(APPEND ${CMAKE_BINARY_DIR}/CTestTestfile.cmake "subdirs(\"wasm\")\n")
    ExternalProject_Add_StepTargets(wasm test)
    install(CODE "include(${CMAKE_CURRENT_BINARY_DIR}/wasm/cmake_install.cmake)" COMPONENT libpsibase)
else()
    message(WARNING "WASI_SDK_PREFIX isn't defined; skipping wasm")
endif()

# Documentation
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
    BUILD_ALWAYS        1
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
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
    DEPENDS gen-cpp-doc ${doc-src} ${doc-cpp} ${doc-cmake} ${doc-headers} ${doc-service-headers}
    COMMAND ${CMAKE_COMMAND} -E remove_directory ${CMAKE_CURRENT_BINARY_DIR}/book
    COMMAND mdbook build -d ${CMAKE_CURRENT_BINARY_DIR}/book ${CMAKE_CURRENT_BINARY_DIR}/doc/psidk
    COMMAND find ${CMAKE_CURRENT_BINARY_DIR}/book "(" -name ".*" -o -name "*~" ")" -delete
    VERBATIM
)
add_custom_target(
    doc
    DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
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

# Cargo psibase
ExternalProject_Add(
    cargo-psibase
    SOURCE_DIR          ${CMAKE_CURRENT_SOURCE_DIR}/rust
    CONFIGURE_COMMAND   ""
    BUILD_COMMAND       cargo build -r --bin cargo-psibase --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/rust/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
    BUILD_BYPRODUCTS    ${CMAKE_CURRENT_BINARY_DIR}/rust/release/cargo-psibase
    BUILD_ALWAYS        1
    INSTALL_COMMAND     ""
)

# UIs built with yarn
set(JS_DIRS
    services/user/CommonApi/ui:CommonApi_js
    services/user/Supervisor/ui:Supervisor_js
    services/user/Explorer/ui:Explorer_js
)
set(ADMIN_DIR services/user/XAdmin/ui:XAdmin_js)
set(COMMON_LIB_DIR services/user/CommonApi/common/packages/common-lib/:CommonApiCommonLib_js)
set(COMMON_LOADER_DIR services/user/CommonApi/common/packages/wasm-loader/:CommonApiLoaderLib_js)

function(add_js_target TARGET_TUPLE OUTPUT_FILE)
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${TARGET_TUPLE})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${TARGET_TUPLE})
    set(OUTPUT_FILEPATH ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/dist/${OUTPUT_FILE})
    file(GLOB_RECURSE SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/src/*)

    # Add a command that rebuilds `${OUTPUT_FILEPATH}` whenever any sources or dependencies are updated
    add_custom_command(
        OUTPUT ${OUTPUT_FILEPATH}
        DEPENDS ${SOURCES} ${ARGN}
        COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/${PATH} && yarn --mutex network && yarn build
    )
    # Create a custom target to ensure `${OUTPUT_FILEPATH}` is built before `${TARGET_NAME}`
    add_custom_target(${TARGET_NAME} DEPENDS ${OUTPUT_FILEPATH})
    # Expose `${TARGET_NAME}` and its dependency to the parent scope for further use
    set(${TARGET_NAME}_DEP ${TARGET_NAME} ${OUTPUT_FILEPATH} PARENT_SCOPE)
endfunction()

# Static (not built) resource dependencies
file(GLOB common-misc-resources LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/*)
file(GLOB common-fonts LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/fonts/*)

# Builds the Common Sys files that the UIs (just below) depend on
add_js_target(${COMMON_LIB_DIR} common-lib.js)
add_js_target(${COMMON_LOADER_DIR} index.html ${CommonApiCommonLib_js_DEP})

# Build each UI
# Each of these UIs receives the build output of CommonApi, so CommonApi files are listed as dependencies
foreach(ROW ${JS_DIRS})
    add_js_target(${ROW} index.html ${common-misc-resources} ${common-fonts} ${CommonApiCommonLib_js_DEP} ${CommonApiLoaderLib_js_DEP})
endforeach()

# A function that can be used to add a new target that builds a wasm component from rust
set(COMPONENT_BIN_DIR ${CMAKE_CURRENT_BINARY_DIR}/components)
function(add_rs_component TARGET_TUPLE OUTPUT_FILE)
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${TARGET_TUPLE})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${TARGET_TUPLE})
    set(OUTPUT_FILEPATH ${COMPONENT_BIN_DIR}/${OUTPUT_FILE})

    ExternalProject_Add(${TARGET_NAME}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}
        BUILD_BYPRODUCTS ${OUTPUT_FILEPATH}
        CONFIGURE_COMMAND ""
        BUILD_COMMAND cargo component build -r
            --target wasm32-wasi
            --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/Cargo.toml 
            --target-dir    ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/target
        BUILD_ALWAYS 1
        INSTALL_COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/target/wasm32-wasi/release/${OUTPUT_FILE} ${OUTPUT_FILEPATH}
    )

    # Expose `${TARGET_NAME}` and its dependency to the parent scope for further use
    set(${TARGET_NAME}_DEP ${TARGET_NAME} ${OUTPUT_FILEPATH} PARENT_SCOPE)
    set(${TARGET_NAME}_OUTPUT_FILE ${OUTPUT_FILE} PARENT_SCOPE)
endfunction()

# Static (not built) resource dependencies
file(GLOB plugin-wit LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/wit/*)

# Build each component
set(COMPONENT_PARSER_DIR services/user/CommonApi/common/packages/component-parser:ComponentParser)
add_rs_component(${COMPONENT_PARSER_DIR} component_parser.wasm)
add_dependencies(CommonApiCommonLib_js ComponentParser)

add_rs_component(services/system/Accounts/plugin:AccountsPlugin accounts.wasm ${plugin-wit})
add_rs_component(services/system/AuthSig/plugin:AuthPlugin auth_sig.wasm ${plugin-wit})
add_rs_component(services/user/Invite/plugin:InvitesPlugin invite.wasm ${plugin-wit} ${AuthPlugin_DEP})

set(WASM_PSIBASE_BYPRODUCTS
    ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase/wasm-psibase_bg.js
    ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase/wasm-psibase_bg.wasm
    ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase/wasm-psibase_bg.wasm.d.ts
    ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase/wasm-psibase.d.ts
    ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase/wasm-psibase.js
)
add_js_target(${ADMIN_DIR} index.html ${WASM_PSIBASE_BYPRODUCTS})
add_custom_command(
    OUTPUT ${WASM_PSIBASE_BYPRODUCTS}
    DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase
    COMMAND wasm-pack build ${CMAKE_CURRENT_SOURCE_DIR}/rust/psibase --out-dir ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/wasm-psibase --out-name wasm-psibase
)
add_custom_target(wasm-psibase ALL DEPENDS ${WASM_PSIBASE_BYPRODUCTS})
add_dependencies(wasm-psibase rust)

function(psinode_files target pfx)
    add_custom_target(
    ${target}
    ALL
    DEPENDS XAdmin_js
    COMMAND rm -rf ${pfx}/share/psibase/services/x-admin
    COMMAND mkdir -p ${pfx}/share/psibase/services
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/dist ${pfx}/share/psibase/services/x-admin
    COMMAND mkdir -p ${pfx}/share/psibase/services/x-admin/common
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/fonts ${pfx}/share/psibase/services/x-admin/common/fonts
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib/dist/common-lib.js ${pfx}/share/psibase/services/x-admin/common/
    COMMAND cp ${CMAKE_CURRENT_SOURCE_DIR}/programs/psinode/config.in ${pfx}/share/psibase/config.in
    COMMAND ${CMAKE_COMMAND} -E create_symlink ../../packages ${pfx}/share/psibase/services/x-admin/packages
    )
endfunction()

psinode_files(psinode-share ${CMAKE_CURRENT_BINARY_DIR})
add_dependencies(XAdmin_js wasm-psibase CommonApiCommonLib_js)

include(GNUInstallDirs)
install(DIRECTORY services/user/XAdmin/ui/dist/ DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin COMPONENT ServerData)
install(DIRECTORY services/user/CommonApi/common/resources/fonts DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin/common COMPONENT ServerData)
install(FILES services/user/CommonApi/common/packages/common-lib/dist/common-lib.js DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin/common COMPONENT ServerData)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/share/psibase/services/x-admin/packages DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin COMPONENT ServerData)

# Build service packages
include(libraries/psibase/sdk/pack_service.cmake)

set(SERVICE_DIR ${CMAKE_CURRENT_BINARY_DIR}/share/psibase/packages)

set(PSIBASE_VERSION "0.7.0")

psibase_package(
    OUTPUT ${SERVICE_DIR}/Transact.psi
    NAME Transact
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "All transactions enter the chain through this service"
    SERVICE transact
    WASM ${CMAKE_CURRENT_BINARY_DIR}/Transact.wasm
    FLAGS allowSudo allowWriteNative
    DEPENDS wasm
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION})" "CpuLimit(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Accounts.psi
    NAME Accounts
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "This service facilitates the creation of new accounts"
    SERVICE accounts
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Accounts.wasm
        SERVER r-accounts
        INIT
    SERVICE r-accounts
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAccounts.wasm
        DATA ${COMPONENT_BIN_DIR}/${AccountsPlugin_OUTPUT_FILE} /plugin.wasm
    DEPENDS wasm
    DEPENDS ${AccountsPlugin_DEP}
    PACKAGE_DEPENDS "AuthAny(^${PSIBASE_VERSION})" "HttpServer(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthSig.psi
    NAME AuthSig
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Auth service using Botan to verify signatures"
    SERVICE auth-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthSig.wasm
        SERVER r-auth-sig
    SERVICE r-auth-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAuthSig.wasm
        DATA ${COMPONENT_BIN_DIR}/${AuthPlugin_OUTPUT_FILE} /plugin.wasm
    SERVICE verify-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/VerifySig.wasm
        FLAGS isAuthService
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})"
)

set(COMMON_API ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi)
set(THIRD_SRC ${COMMON_API}/common/resources/thirdParty/src)
set(THIRD_FILES
    ${THIRD_SRC}/htm.module.js
    ${THIRD_SRC}/react-dom.development.js
    ${THIRD_SRC}/react-dom.production.min.js
    ${THIRD_SRC}/react-router-dom.min.js
    ${THIRD_SRC}/react.development.js
    ${THIRD_SRC}/react.production.min.js
    ${THIRD_SRC}/semantic-ui-react.min.js
    ${THIRD_SRC}/useLocalStorageState.js)

psibase_package(
    OUTPUT ${SERVICE_DIR}/CommonApi.psi
    NAME CommonApi
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Service that contains the common files and libraries used by apps on psibase"
    SERVICE common-api
        WASM ${CMAKE_CURRENT_BINARY_DIR}/CommonApi.wasm
        SERVER common-api
        DATA GLOB ${COMMON_API}/common/packages/wasm-loader/dist/*            common/wasm-loader/
        DATA      ${COMMON_API}/common/packages/common-lib/dist/common-lib.js common/common-lib.js
        DATA GLOB ${COMMON_API}/common/resources/*.mjs                        common/
        DATA      ${COMMON_API}/common/resources/fonts                        common/fonts
        DATA GLOB ${COMMON_API}/ui/dist/*                                     /
        DATA GLOB ${THIRD_FILES}                                              common
        DATA      ${COMPONENT_BIN_DIR}/${ComponentParser_OUTPUT_FILE}         /common/${ComponentParser_OUTPUT_FILE}
    DEPENDS ${CommonApi_js_DEP}
    DEPENDS ${CommonApiCommonLib_js_DEP}
    DEPENDS ${CommonApiLoaderLib_js_DEP}
    DEPENDS ${ComponentParser_DEP}
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthDelegate.psi
    NAME AuthDelegate
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Auth service that delegates authorization to another account"
    SERVICE auth-delegate
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthDelegate.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthK1.psi
    NAME AuthK1
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Auth service using secp256k1 to verify signatures"
    SERVICE auth-k1
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthK1.wasm
        SERVER r-ath-ec-sys
    SERVICE r-ath-ec-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAuthK1.wasm
    SERVICE verifyk1
        WASM ${CMAKE_CURRENT_BINARY_DIR}/VerifyK1.wasm
        FLAGS isAuthService
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthAny.psi
    NAME AuthAny
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Insecure auth service that allows any access"
    SERVICE auth-any
    WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthAny.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/CpuLimit.psi
    NAME CpuLimit
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Service that manages CPU billing"
    SERVICE cpu-limit
    WASM ${CMAKE_CURRENT_BINARY_DIR}/CpuLimit.wasm
    FLAGS isSubjective canSetTimeLimit
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/DocSys.psi
    NAME DocSys
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Psibase documentation"
    SERVICE doc-sys
    DATA ${CMAKE_CURRENT_BINARY_DIR}/book/html /
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION})" "Accounts(^${PSIBASE_VERSION})"
    DEPENDS doc ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Nop.psi
    NAME Nop
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Service that does nothing"
    SERVICE nop
    WASM ${CMAKE_CURRENT_BINARY_DIR}/Nop.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Sites.psi
    NAME Sites
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Provides web hosting to non-service accounts"
    SERVICE sites
    WASM ${CMAKE_CURRENT_BINARY_DIR}/Sites.wasm
    SERVER sites
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Producers.psi
    NAME Producers
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Manages the active producers"
    SERVICE producers
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Producers.wasm
        FLAGS allowWriteNative
        SERVER r-prod-sys
    SERVICE r-prod-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RProducers.wasm
    ACCOUNTS prods-weak prods-strong
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/system/Producers/src/postinstall.json
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})" "Accounts(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/HttpServer.psi
    NAME HttpServer
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "The `http-server` service routes HTTP requests to the appropriate service"
    SERVICE http-server
        WASM ${CMAKE_CURRENT_BINARY_DIR}/HttpServer.wasm
        SERVER rhttp-server
    SERVICE rhttp-server
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RHttpServer.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/SetCode.psi
    NAME SetCode
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "All compiled code is uploaded to the chain through this service"
    SERVICE setcode
    WASM ${CMAKE_CURRENT_BINARY_DIR}/SetCode.wasm
    FLAGS allowWriteNative
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Explorer.psi
    NAME Explorer
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Block explorer"
    SERVICE explorer
    WASM ${CMAKE_CURRENT_BINARY_DIR}/Explorer.wasm
    SERVER explorer
    DATA ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Explorer/ui/dist /
    DEPENDS Explorer_js ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Explorer/ui/dist/index.html
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Invite.psi
    NAME Invite
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "This service facilitates the creation and redemption of invites"
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION})" "HttpServer(^${PSIBASE_VERSION})" "Nft(^${PSIBASE_VERSION})" "TokenSys(^${PSIBASE_VERSION})" "AuthK1(^${PSIBASE_VERSION})"
    SERVICE invite
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Invite.wasm
        SERVER invite
        INIT
        DATA ${COMPONENT_BIN_DIR}/${InvitesPlugin_OUTPUT_FILE} /plugin.wasm
    SERVICE auth-inv-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthInvite.wasm
    DEPENDS wasm
    DEPENDS ${InvitesPlugin_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Nft.psi
    NAME Nft
    VERSION ${PSIBASE_VERSION}
    SERVICE nft
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION})" "HttpServer(^${PSIBASE_VERSION})"
    WASM ${CMAKE_CURRENT_BINARY_DIR}/Nft.wasm
    INIT
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Supervisor.psi
    NAME Supervisor
    VERSION ${PSIBASE_VERSION}
    PACKAGE_DEPENDS Nft HttpServer Accounts
    SERVICE supervisor
        DATA ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Supervisor/ui/dist /
    DEPENDS ${Supervisor_js_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/TokenSys.psi
    NAME TokenSys
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Token service"
    PACKAGE_DEPENDS "Nft(^${PSIBASE_VERSION})" "HttpServer(^${PSIBASE_VERSION})"
    SERVICE token-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/TokenSys.wasm
        SERVER r-tok-sys
        INIT
    SERVICE r-tok-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RTokenSys.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/SymbolSys.psi
    NAME SymbolSys
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Symbol service"
    PACKAGE_DEPENDS "TokenSys(^${PSIBASE_VERSION})" "Nft(^${PSIBASE_VERSION})"
    SERVICE symbol-sys
        WASM ${CMAKE_CURRENT_BINARY_DIR}/SymbolSys.wasm
        INIT
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Fractal.psi
    NAME Fractal
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Fractal service"
    SERVICE fractal
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Fractal.wasm
    SERVICE core-fractal
        WASM ${CMAKE_CURRENT_BINARY_DIR}/CoreFractal.wasm
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/TokenUsers.psi
    NAME TokenUsers
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Initial token users"
    ACCOUNTS alice bob
    PACKAGE_DEPENDS "TokenSys(^${PSIBASE_VERSION})" "SymbolSys(^${PSIBASE_VERSION})" "Accounts(^${PSIBASE_VERSION})"
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/TokenSys/src/TokenUsers.json
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Packages.psi
    NAME Packages
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Package manager for psibase apps"
    SERVICE packages
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Packages.wasm
        SERVER r-packages
    SERVICE r-packages
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RPackages.wasm
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION})" "Nop(^${PSIBASE_VERSION})"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Default.psi
    NAME Default
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "All default services"
    PACKAGE_DEPENDS Accounts AuthAny AuthSig AuthDelegate AuthK1 CommonApi CpuLimit DocSys
                    Explorer Fractal Invite Nft Packages Producers HttpServer
                    Sites SetCode Supervisor SymbolSys TokenUsers TokenSys Transact
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Minimal.psi
    NAME Minimal
    VERSION ${PSIBASE_VERSION}
    DESCRIPTION "Minimum services for a functional chain"
    PACKAGE_DEPENDS Accounts AuthDelegate AuthAny CpuLimit CommonApi Packages Producers HttpServer
                    SetCode Transact
)

function(write_package_index out)
    set(deps ${CMAKE_CURRENT_SOURCE_DIR}/make_package_index.sh)
    foreach(service IN LISTS ARGN)
        list(APPEND deps ${service} ${SERVICE_DIR}/${service}.psi)
    endforeach()
    add_custom_command(
        OUTPUT ${SERVICE_DIR}/index.json
        DEPENDS ${deps}
        COMMAND /usr/bin/bash ${CMAKE_CURRENT_SOURCE_DIR}/make_package_index.sh ${CMAKE_COMMAND} ${SERVICE_DIR} >${SERVICE_DIR}/index.json
    )
    add_custom_target(index.json ALL DEPENDS ${SERVICE_DIR}/index.json)
endfunction()

write_package_index(${SERVICE_DIR}/index.json
    Accounts AuthAny AuthSig AuthK1 CommonApi CpuLimit Default
    DocSys Explorer Fractal Invite Nft Nop Minimal Packages Producers HttpServer
    Sites SetCode Supervisor SymbolSys TokenUsers TokenSys Transact)

install(
    FILES ${SERVICE_DIR}/index.json
          ${SERVICE_DIR}/Accounts.psi
          ${SERVICE_DIR}/AuthAny.psi
          ${SERVICE_DIR}/AuthDelegate.psi
          ${SERVICE_DIR}/AuthSig.psi
          ${SERVICE_DIR}/AuthK1.psi
          ${SERVICE_DIR}/CommonApi.psi
          ${SERVICE_DIR}/Default.psi
          ${SERVICE_DIR}/CpuLimit.psi
          ${SERVICE_DIR}/DocSys.psi
          ${SERVICE_DIR}/Explorer.psi
          ${SERVICE_DIR}/Fractal.psi
          ${SERVICE_DIR}/Invite.psi
          ${SERVICE_DIR}/Minimal.psi
          ${SERVICE_DIR}/Nft.psi
          ${SERVICE_DIR}/Nop.psi
          ${SERVICE_DIR}/Packages.psi
          ${SERVICE_DIR}/Producers.psi
          ${SERVICE_DIR}/HttpServer.psi
          ${SERVICE_DIR}/Sites.psi
          ${SERVICE_DIR}/SetCode.psi
          ${SERVICE_DIR}/Supervisor.psi
          ${SERVICE_DIR}/SymbolSys.psi
          ${SERVICE_DIR}/TokenUsers.psi
          ${SERVICE_DIR}/TokenSys.psi
          ${SERVICE_DIR}/Transact.psi
    DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/packages/
    COMPONENT ServerData)

ExternalProject_Add(
    rust
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/rust
    BUILD_BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase
    CONFIGURE_COMMAND ""
    BUILD_COMMAND   cargo build -r --bin psibase --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/rust/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
    BUILD_ALWAYS 1
    INSTALL_COMMAND ""
)
install(PROGRAMS ${CMAKE_CURRENT_BINARY_DIR}/rust/release/psibase TYPE BIN COMPONENT Client)

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
