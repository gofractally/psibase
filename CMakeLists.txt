cmake_minimum_required(VERSION 3.16.3)
cmake_policy(VERSION 3.16.3...3.31.6)
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
file(APPEND ${CMAKE_BINARY_DIR}/CTestTestfile.cmake "subdirs(\"native\" \"rust\")\n")

option(BUILD_DEBUG_WASM "Build debug wasms" OFF)

include(GNUInstallDirs)

if(DEFINED WASI_SDK_PREFIX)
    install(DIRECTORY ${WASI_SDK_PREFIX}/ USE_SOURCE_PERMISSIONS DESTINATION . COMPONENT WASI EXCLUDE_FROM_ALL)
elseif(${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Linux")
    if (${CMAKE_HOST_SYSTEM_PROCESSOR} STREQUAL "x86_64")
        set(WASI_SDK_URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-x86_64-linux.tar.gz)
        set(WASI_SDK_SHA256 c6c38aab56e5de88adf6c1ebc9c3ae8da72f88ec2b656fb024eda8d4167a0bc5)
    elseif(${CMAKE_HOST_SYSTEM_PROCESSOR} MATCHES "^(arm|aarch).*" )
        set(WASI_SDK_URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-arm64-linux.tar.gz)
        set(WASI_SDK_SHA256 ae6c1417ea161e54bc54c0a168976af57a0c6e53078857886057a71a0d928646)
    endif()
    if(DEFINED WASI_SDK_URL)
        ExternalProject_Add(wasi-sdk
            URL ${WASI_SDK_URL}
            URL_HASH SHA256=${WASI_SDK_SHA256}
            CONFIGURE_COMMAND ""
            BUILD_COMMAND ""
            INSTALL_COMMAND ""
        )

        ExternalProject_Get_Property(wasi-sdk SOURCE_DIR)
        set(WASI_SDK_PREFIX ${SOURCE_DIR})
        set(wasm-deps wasi-sdk)
        install(DIRECTORY ${WASI_SDK_PREFIX}/ USE_SOURCE_PERMISSIONS DESTINATION . COMPONENT WASI)
    endif()
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
        CONFIGURE_COMMAND <SOURCE_DIR>/configure.py --cc-bin=${WASI_SDK_PREFIX}/bin/clang++ --cc=gcc --cpu=generic --os=none --ar-command=${WASI_SDK_PREFIX}/bin/llvm-ar --build-targets=static --with-sysroot-dir=${WASI_SDK_PREFIX}/share/wasi-sysroot --minimized-build --enable-modules=ecdsa,raw_hash,auto_rng,sha2_64,getentropy --with-os-feature=getentropy "--cxxflags=--target=wasm32-wasip1 -O3 -msign-ext -mnontrapping-fptoint -mbulk-memory" --without-stack-protector --prefix=<INSTALL_DIR>
        BUILD_COMMAND make -j${NUM_PROCS}
        INSTALL_COMMAND make install
    )
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps/lib/libbotan-3.a
        DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/lib
        COMPONENT libpsibase
    )
    install(DIRECTORY ${CMAKE_BINARY_DIR}/wasm/deps/include/botan-3
        DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/include
        COMPONENT libpsibase
    )

    ExternalProject_Add(wasm-catch2
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/external/Catch2
        BINARY_DIR catch2
        TEST_EXCLUDE_FROM_MAIN 1
        EXCLUDE_FROM_ALL 1
        PREFIX ${CMAKE_CURRENT_BINARY_DIR}/wasm/catch2
        INSTALL_DIR ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps
        CMAKE_ARGS
            -DCMAKE_BUILD_TYPE=Release
            -DCMAKE_INSTALL_PREFIX=<INSTALL_DIR>
            -DBUILD_TESTING=OFF
            -DCATCH_INSTALL_DOCS=OFF
            -DCATCH_INSTALL_EXTRAS=OFF
            -DCATCH_CONFIG_NO_POSIX_SIGNALS=ON
            -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
            -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
            -DCMAKE_TOOLCHAIN_FILE=${CMAKE_CURRENT_SOURCE_DIR}/wasm/toolchain.cmake
            -DWASI_SDK_PREFIX=${WASI_SDK_PREFIX}
            -DWASM_CLANG_PREFIX=${WASM_CLANG_PREFIX}
            -DWASM_CLANG_SUFFIX=${WASM_CLANG_SUFFIX}
            -DCMAKE_SYSROOT=${WASI_SDK_PREFIX}/share/wasi-sysroot
    )
    install(
        FILES ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps/lib/libCatch2.a
              ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps/lib/libCatch2Main.a
        DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/lib
        COMPONENT libpsibase
    )
    install(DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps/lib/cmake/Catch2
        DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/lib/cmake
        COMPONENT libpsibase
    )
    install(DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/wasm/deps/include/catch2
        DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/include
        COMPONENT libpsibase
    )
    install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/external/Catch2/LICENSE.txt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/licenses RENAME LICENSE.catch2 COMPONENT libpsibase)

    set(SERVICES Accounts AuthDelegate AuthSig AuthAny AuthInvite CommonApi
        CpuLimit Events Explorer Invite Nft
        Nop Packages Producers HttpServer Sites RAccounts
        RAuthSig RAuthDelegate REvents RInvite RPackages RProducers
        RHttpServer RSetCode RTokens RTransact SetCode Symbol
        Tokens Transact VerifySig XAdmin
        PSubjectiveService CounterService AsyncQueryService
        SubjectiveCounterService KeepSocketService SocketListService)
    set(WASM_BYPRODUCTS)
    foreach(s ${SERVICES})
        list(APPEND WASM_BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/${s}.wasm ${CMAKE_CURRENT_BINARY_DIR}/${s}-schema.json)
    endforeach()

    ExternalProject_Add(wasm
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/wasm
        DEPENDS ${wasm-deps} wasm-botan wasm-catch2 psitest
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
            -DPSITEST_EXECUTABLE=$<TARGET_FILE:psitest>
        BUILD_BYPRODUCTS ${WASM_BYPRODUCTS}
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

configure_file(doc/book.toml.in doc/book.toml)
configure_file(doc/theme/index.hbs doc/theme/index.hbs)
ADD_BOOK_FILES("/doc/theme/js/" "js")
ADD_BOOK_FILES("/doc/theme/css/" "css")
ADD_BOOK_FILES("/doc/src/_img/" "svg")

file(GLOB_RECURSE doc-src ${CMAKE_CURRENT_SOURCE_DIR}/doc/src/*.md)
list(APPEND doc-src ${CMAKE_CURRENT_BINARY_DIR}/doc/book.toml)

file(GLOB_RECURSE doc-cpp ${CMAKE_CURRENT_SOURCE_DIR}/doc/src/development/services/cpp-service/*.cpp)
file(GLOB_RECURSE doc-cmake doc/src/development/services/cpp-service/*/CMakeLists.txt)
file(GLOB doc-headers libraries/psibase/common/include/psibase/*.hpp)
file(GLOB doc-service-headers services/*/*/include/services/*/*.hpp)
add_custom_command(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
    BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/book/html
    DEPENDS gen-cpp-doc ${doc-src} ${doc-cpp} ${doc-cmake} ${doc-headers} ${doc-service-headers}
    COMMAND ${CMAKE_COMMAND} -E remove_directory ${CMAKE_CURRENT_BINARY_DIR}/book
    COMMAND mdbook build -d ${CMAKE_CURRENT_BINARY_DIR}/book ${CMAKE_CURRENT_BINARY_DIR}/doc
    COMMAND find ${CMAKE_CURRENT_BINARY_DIR}/book "(" -name ".*" -o -name "*~" ")" -delete
    VERBATIM
)
add_custom_target(
    doc
    DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
)

function(add_manpage name)
    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/doc/${name}.1
        DEPENDS md2man doc/src/run-infrastructure/cli/${name}.md
        COMMAND ${CMAKE_CURRENT_BINARY_DIR}/rust/release/md2man < ${CMAKE_CURRENT_SOURCE_DIR}/doc/src/run-infrastructure/cli/${name}.md > ${CMAKE_CURRENT_BINARY_DIR}/doc/${name}.1
    )
    add_custom_target(${name}.1 ALL DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/doc/${name}.1)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/doc/${name}.1 TYPE MAN COMPONENT Client)
endfunction()

add_manpage(psinode)
add_manpage(psibase)
add_manpage(psibase-create-snapshot)
add_manpage(psibase-load-snapshot)

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

include(web-apps.cmake)

# Static (not built) resource dependencies
file(GLOB plugin-wit LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/wit/*)

# Build each component
include(libraries/psibase/sdk/rs-components.cmake)
add_rs_component(services/user/CommonApi/common/packages/component-parser:ComponentParser component_parser.wasm wasm32-unknown-unknown)
add_dependencies(CommonApiCommonLib_js ComponentParser)

add_rs_component_workspace(services/:Plugins 
    accounts
    account-tokens
    aes
    auth-any
    auth-delegate
    auth-invite
    auth-sig
    base64
    kdf
    setcode
    clientdata
    invite
    packages
    permissions
    sites
    test
    tokens
    transact
    workshop
    producers
)

function(psinode_files target pfx)
    add_custom_target(
    ${target}
    ALL
    DEPENDS XAdmin_js wasm
    COMMAND rm -rf ${pfx}/share/psibase/services/x-admin
    COMMAND mkdir -p ${pfx}/share/psibase/services
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/XAdmin/ui/dist ${pfx}/share/psibase/services/x-admin
    COMMAND cp -a ${CMAKE_CURRENT_BINARY_DIR}/XAdmin.wasm ${pfx}/share/psibase/services/x-admin.wasm
    COMMAND mkdir -p ${pfx}/share/psibase/services/x-admin/common
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/fonts ${pfx}/share/psibase/services/x-admin/common/fonts
    COMMAND cp -a ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib/dist/common-lib.js ${pfx}/share/psibase/services/x-admin/common/
    COMMAND cp ${CMAKE_CURRENT_SOURCE_DIR}/programs/psinode/config.in ${pfx}/share/psibase/config.in
    COMMAND ${CMAKE_COMMAND} -E create_symlink ../../packages ${pfx}/share/psibase/services/x-admin/packages
    )
endfunction()

psinode_files(psinode-share ${CMAKE_CURRENT_BINARY_DIR})

include(GNUInstallDirs)
install(DIRECTORY services/user/XAdmin/ui/dist/ DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin COMPONENT ServerData)
install(DIRECTORY services/user/CommonApi/common/resources/fonts DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin/common COMPONENT ServerData)
install(FILES services/user/CommonApi/common/packages/common-lib/dist/common-lib.js DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin/common COMPONENT ServerData)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/share/psibase/services/x-admin/packages DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/services/x-admin COMPONENT ServerData)

# Build service packages
include(libraries/psibase/sdk/pack_service.cmake)

set(SERVICE_DIR ${CMAKE_CURRENT_BINARY_DIR}/share/psibase/packages)

set(PSIBASE_VERSION 0.19)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Transact.psi
    NAME Transact
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "All transactions enter the chain through this service"
    SERVICE transact
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Transact.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Transact-schema.json
        FLAGS allowSudo allowWriteNative
        SERVER r-transact
        DATA ${Plugins_OUTPUT_FILE_transact} /plugin.wasm
    SERVICE r-transact
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RTransact.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RTransact-schema.json
        FLAGS allowWriteSubjective allowNativeSubjective
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/system/Transact/src/postinstall.json
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION}.0)" "CpuLimit(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Accounts.psi
    NAME Accounts
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "This service facilitates the creation of new accounts"
    SERVICE accounts
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Accounts.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Accounts-schema.json
        SERVER r-accounts
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/system/Accounts/ui/dist/* /
        DATA ${Plugins_OUTPUT_FILE_accounts} /plugin.wasm
        DATA ${Plugins_OUTPUT_FILE_account_tokens} /account-tokens.wasm
        INIT
    SERVICE r-accounts
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAccounts.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RAccounts-schema.json
    DEPENDS ${Accounts_js_DEP}
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "AuthAny(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Base64.psi
    NAME Base64
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Base64 encoding and decoding"
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    SERVICE base64
        DATA ${Plugins_OUTPUT_FILE_base64} /plugin.wasm
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Kdf.psi
    NAME Kdf
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Key Derivation Function"
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    SERVICE kdf
        DATA ${Plugins_OUTPUT_FILE_kdf} /plugin.wasm
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Aes.psi
    NAME Aes
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "AES encryption"
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    SERVICE aes
        DATA ${Plugins_OUTPUT_FILE_aes} /plugin.wasm
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/ClientData.psi
    NAME ClientData
    DESCRIPTION "Plugin for enabling simpler interactions with client-side data storage"
    VERSION ${PSIBASE_VERSION}.0
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "CommonApi(^${PSIBASE_VERSION}.0)" "Supervisor(^${PSIBASE_VERSION}.0)"
    SERVICE clientdata
        DATA ${Plugins_OUTPUT_FILE_clientdata} /plugin.wasm
    DEPENDS ${Plugins_DEP}
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Chainmail.psi
    PATH services/user/Chainmail
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Profiles.psi
    PATH services/user/Profiles
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Evaluations.psi
    PATH services/user/Evaluations
    DEPENDS ${Evaluations_js_DEP}
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Fractals.psi
    PATH services/user/Fractals
    DEPENDS ${Fractals_js_DEP}
)


cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Branding.psi
    PATH services/user/Branding
    DEPENDS ${Branding_js_DEP}
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/BrotliCodec.psi
    PATH services/user/BrotliCodec
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Registry.psi
    PATH services/user/Registry
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/StagedTx.psi
    PATH services/system/StagedTx
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Subgroups.psi
    PATH services/user/Subgroups
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthSig.psi
    NAME AuthSig
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Auth service using Botan to verify signatures"
    SERVICE auth-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthSig.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/AuthSig-schema.json
        DATA ${Plugins_OUTPUT_FILE_auth_sig} /plugin.wasm
        SERVER r-auth-sig
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/system/AuthSig/ui/dist/* /
    SERVICE r-auth-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAuthSig.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RAuthSig-schema.json
    SERVICE verify-sig
        WASM ${CMAKE_CURRENT_BINARY_DIR}/VerifySig.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/VerifySig-schema.json
        FLAGS isAuthService
    DEPENDS ${AuthSig_js_DEP}
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
    # This dependency is removed as a hack to get tests to pass in CICD.
    # Test boots don't load UI elements, so the setCsp Permissions calls, fails
    # "Permissions(^${PSIBASE_VERSION}.0)"
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
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Service that contains the common files and libraries used by apps on psibase"
    SERVICE common-api
        WASM ${CMAKE_CURRENT_BINARY_DIR}/CommonApi.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/CommonApi-schema.json
        SERVER common-api
        DATA      ${COMMON_API}/common/packages/common-lib/dist/common-lib.js common/common-lib.js
        DATA GLOB ${COMMON_API}/common/resources/*.mjs                        common/
        DATA      ${COMMON_API}/common/resources/fonts                        common/fonts
        DATA GLOB ${THIRD_FILES}                                              common
        DATA      ${COMPONENT_BIN_DIR}/${ComponentParser_OUTPUT_FILE}         /common/${ComponentParser_OUTPUT_FILE}
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/plugin-tester/ui/dist/* /common/plugin-tester/
    DEPENDS CommonApiCommonLib_js
    DEPENDS ${ComponentParser_DEP}
    DEPENDS ${PluginTester_js_DEP}
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthDelegate.psi
    NAME AuthDelegate
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Auth service that delegates authorization to another account"
    SERVICE auth-delegate
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthDelegate.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/AuthDelegate-schema.json
        DATA ${Plugins_OUTPUT_FILE_auth_delegate} /plugin.wasm
        SERVER r-auth-dlg
    SERVICE r-auth-dlg
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RAuthDelegate.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RAuthDelegate-schema.json
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/AuthAny.psi
    NAME AuthAny
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Insecure auth service that allows any access"
    SERVICE auth-any
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthAny.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/AuthAny-schema.json
        DATA ${Plugins_OUTPUT_FILE_auth_any} /plugin.wasm
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/CpuLimit.psi
    NAME CpuLimit
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Service that manages CPU billing"
    SERVICE cpu-limit
        WASM ${CMAKE_CURRENT_BINARY_DIR}/CpuLimit.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/CpuLimit-schema.json
        FLAGS isSubjective canSetTimeLimit
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Docs.psi
    NAME Docs
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Psibase documentation"
    SERVICE docs
        DATA ${CMAKE_CURRENT_BINARY_DIR}/book/html /
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    DEPENDS doc ${CMAKE_CURRENT_BINARY_DIR}/book/html/index.html
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Homepage.psi
    NAME Homepage
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Network homepage"
    SERVICE homepage
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Homepage/ui/dist/*  /
        POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Homepage/postinstall.json
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "Profiles(^${PSIBASE_VERSION}.0)"
    DEPENDS ${Homepage_js_DEP}
)

cargo_psibase_package(
    OUTPUT ${SERVICE_DIR}/Identity.psi
    PATH services/user/Identity
    DEPENDS ${Identity_js_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Nop.psi
    NAME Nop
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Service that does nothing"
    SERVICE nop
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Nop.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Nop-schema.json
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Sites.psi
    NAME Sites
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Provides web hosting to non-service accounts"
    SERVICE sites
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Sites.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Sites-schema.json
        SERVER sites
        DATA ${Plugins_OUTPUT_FILE_sites} /plugin.wasm
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Producers.psi
    NAME Producers
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Manages the active producers"
    SERVICE producers
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Producers.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Producers-schema.json
        DATA ${Plugins_OUTPUT_FILE_producers} /plugin.wasm
        FLAGS allowWriteNative
        SERVER r-producers
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/system/Producers/ui/dist/* /
    SERVICE r-producers
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RProducers.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RProducers-schema.json
    ACCOUNTS prods-weak prods-strong
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/system/Producers/src/postinstall.json
    DEPENDS wasm
    DEPENDS ${Producers_js_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "AuthSig(^${PSIBASE_VERSION}.0)" "StagedTx(^${PSIBASE_VERSION}.0)" "Transact(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/HttpServer.psi
    NAME HttpServer
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "The `http-server` service routes HTTP requests to the appropriate service"
    SERVICE http-server
        WASM ${CMAKE_CURRENT_BINARY_DIR}/HttpServer.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/HttpServer-schema.json
        SERVER rhttp-server
        FLAGS allowSocket allowWriteSubjective
    SERVICE rhttp-server
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RHttpServer.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RHttpServer-schema.json
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/SetCode.psi
    NAME SetCode
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "All compiled code is uploaded to the chain through this service"
    SERVICE setcode
        WASM ${CMAKE_CURRENT_BINARY_DIR}/SetCode.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/SetCode-schema.json
        DATA ${Plugins_OUTPUT_FILE_setcode} /plugin.wasm
        FLAGS allowWriteNative
        SERVER r-setcode
        INIT
    SERVICE r-setcode
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RSetCode.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RSetCode-schema.json
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Transact(^${PSIBASE_VERSION}.0)" "StagedTx(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "CommonApi(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Events.psi
    NAME Events
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Indexes events and provides querying"
    SERVICE events
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Events.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Events-schema.json
        FLAGS isSubjective forceReplay
        SERVER r-events
    SERVICE r-events
        WASM ${CMAKE_CURRENT_BINARY_DIR}/REvents.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/REvents-schema.json
        POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Events/src/postinstall.json
    DEPENDS wasm
    PACKAGE_DEPENDS "Transact(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Explorer.psi
    NAME Explorer
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Block explorer"
    SERVICE explorer
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Explorer.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Explorer-schema.json
        SERVER explorer
        DATA ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Explorer/ui/dist /
    DEPENDS ${Explorer_js_DEP}
    DEPENDS wasm
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Invite.psi
    NAME Invite
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "This service facilitates the creation and redemption of invites"
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Nft(^${PSIBASE_VERSION}.0)" "Tokens(^${PSIBASE_VERSION}.0)" "AuthSig(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
    SERVICE invite
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Invite.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Invite-schema.json
        SERVER r-invite
        INIT
        DATA ${Plugins_OUTPUT_FILE_invite} /plugin.wasm
    SERVICE auth-invite
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AuthInvite.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/AuthInvite-schema.json
        DATA ${Plugins_OUTPUT_FILE_auth_invite} /plugin.wasm
    SERVICE r-invite
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RInvite.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RInvite-schema.json
    DEPENDS wasm
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Nft.psi
    NAME Nft
    VERSION ${PSIBASE_VERSION}.0
    PACKAGE_DEPENDS "Accounts(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Events(^${PSIBASE_VERSION}.0)"
    SERVICE nft
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Nft.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Nft-schema.json
        INIT
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Supervisor.psi
    NAME Supervisor
    VERSION ${PSIBASE_VERSION}.0
    PACKAGE_DEPENDS "Nft(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "CommonApi(^${PSIBASE_VERSION}.0)"
    SERVICE supervisor
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Supervisor/ui/dist/* /
    DEPENDS ${Supervisor_js_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Permissions.psi
    NAME Permissions
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Handler for client-side permissions"
    PACKAGE_DEPENDS "Sites(^${PSIBASE_VERSION}.0)" "CommonApi(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Permissions/postinstall.json
    SERVICE permissions
        DATA ${Plugins_OUTPUT_FILE_permissions} /plugin.wasm
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Permissions/ui/dist/* /
    DEPENDS ${Permissions_js_DEP}
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/SupervisorTests.psi
    NAME SupervisorTests
    DESCRIPTION "Plugin functions for testing Supervisor functionality"
    VERSION ${PSIBASE_VERSION}.0
    PACKAGE_DEPENDS "Nft(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)" "CommonApi(^${PSIBASE_VERSION}.0)" "Supervisor(^${PSIBASE_VERSION}.0)"
    SERVICE sup-test
        DATA ${Plugins_OUTPUT_FILE_test} /test.wasm
    DEPENDS ${Plugins_DEP}
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Tokens.psi
    NAME Tokens
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Token service"
    PACKAGE_DEPENDS "Nft(^${PSIBASE_VERSION}.0)" "HttpServer(^${PSIBASE_VERSION}.0)" "Events(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)"
    SERVICE tokens
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Tokens.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Tokens-schema.json
        DATA ${Plugins_OUTPUT_FILE_tokens} /plugin.wasm
        SERVER r-tokens
        INIT
    SERVICE r-tokens
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RTokens.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RTokens-schema.json
    DEPENDS ${Plugins_DEP}
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Symbol.psi
    NAME Symbol
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Symbol service"
    PACKAGE_DEPENDS "Tokens(^${PSIBASE_VERSION}.0)" "Nft(^${PSIBASE_VERSION}.0)"
    SERVICE symbol
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Symbol.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Symbol-schema.json
        INIT
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Workshop.psi
    NAME Workshop
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "A dashboard for developers to create and manage apps"
    PACKAGE_DEPENDS 
        "HttpServer(^${PSIBASE_VERSION}.0)" 
        "Sites(^${PSIBASE_VERSION}.0)" 
        "Accounts(^${PSIBASE_VERSION}.0)" 
        "CommonApi(^${PSIBASE_VERSION}.0)" 
        "Registry(^${PSIBASE_VERSION}.0)" 
        "StagedTx(^${PSIBASE_VERSION}.0)" 
        "Transact(^${PSIBASE_VERSION}.0)"
        "SetCode(^${PSIBASE_VERSION}.0)"
        "Chainmail(^${PSIBASE_VERSION}.0)"
        "ClientData(^${PSIBASE_VERSION}.0)"
    SERVICE workshop
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Workshop/ui/dist/* /
        DATA ${Plugins_OUTPUT_FILE_workshop} /plugin.wasm
    DEPENDS ${Workshop_js_DEP}
    DEPENDS ${Plugins_DEP}
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Workshop/postinstall.json
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/TokenUsers.psi
    NAME TokenUsers
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Initial token users"
    ACCOUNTS alice bob
    PACKAGE_DEPENDS "Tokens(^${PSIBASE_VERSION}.0)" "Symbol(^${PSIBASE_VERSION}.0)" "Accounts(^${PSIBASE_VERSION}.0)"
    POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Tokens/src/TokenUsers.json
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/Packages.psi
    NAME Packages
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Package manager for psibase apps"
    SERVICE packages
        WASM ${CMAKE_CURRENT_BINARY_DIR}/Packages.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/Packages-schema.json
        SERVER r-packages
        DATA GLOB ${CMAKE_CURRENT_SOURCE_DIR}/services/user/Packages/ui/dist/* /
        DATA ${Plugins_OUTPUT_FILE_packages} /plugin.wasm
    SERVICE r-packages
        WASM ${CMAKE_CURRENT_BINARY_DIR}/RPackages.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/RPackages-schema.json
    DEPENDS wasm ${Packages_js_DEP} ${Plugins_DEP}
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)" "Sites(^${PSIBASE_VERSION}.0)" "Nop(^${PSIBASE_VERSION}.0)"
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/DevDefault.psi
    NAME DevDefault
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "All development services"
    PACKAGE_DEPENDS Accounts Aes AuthAny AuthSig AuthDelegate Base64 Branding BrotliCodec Chainmail ClientData CommonApi CpuLimit 
                    Docs Evaluations Events Fractals Explorer HttpServer Identity Invite Kdf Nft Packages Permissions Producers Profiles Registry 
                    Sites SetCode StagedTx Subgroups Supervisor Symbol Tokens Transact Homepage Workshop 
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/ProdDefault.psi
    NAME ProdDefault
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "All production services"
    PACKAGE_DEPENDS Accounts Aes AuthAny AuthSig AuthDelegate Base64 Branding BrotliCodec Chainmail ClientData CommonApi CpuLimit 
                    Docs Events Explorer Fractals HttpServer Invite Kdf Nft Packages Permissions Producers Profiles Registry
                    Sites SetCode StagedTx Supervisor Symbol Tokens Transact Homepage Workshop
)


psibase_package(
    OUTPUT ${SERVICE_DIR}/Minimal.psi
    NAME Minimal
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Minimum services for a functional chain"
    PACKAGE_DEPENDS Accounts AuthDelegate AuthAny CpuLimit CommonApi Packages Producers HttpServer
                    SetCode Transact
)

psibase_package(
    OUTPUT ${SERVICE_DIR}/TestDefault.psi
    NAME TestDefault
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Services used in the tester"
    PACKAGE_DEPENDS AuthSig BrotliCodec Events Minimal Nft Sites StagedTx Supervisor Symbol Tokens
)

function(write_package_index target dir)
    set(deps ${CMAKE_CURRENT_SOURCE_DIR}/make_package_index.sh)
    foreach(service IN LISTS ARGN)
        list(APPEND deps ${service} ${dir}/${service}.psi)
    endforeach()
    add_custom_command(
        OUTPUT ${dir}/index.json
        DEPENDS ${deps}
        COMMAND /usr/bin/bash ${CMAKE_CURRENT_SOURCE_DIR}/make_package_index.sh ${CMAKE_COMMAND} ${dir} ${ARGN} >${dir}/index.json
    )
    add_custom_target(${target} ALL DEPENDS ${dir}/index.json)
endfunction()

write_package_index(package-index ${SERVICE_DIR}
    Accounts Aes AuthAny AuthDelegate AuthSig Base64 Branding BrotliCodec Chainmail ClientData CommonApi CpuLimit DevDefault ProdDefault
    Docs Events Evaluations Fractals Explorer Identity Invite Kdf Nft Nop Minimal Packages Permissions Producers Profiles TestDefault HttpServer Registry 
    Sites SetCode StagedTx Subgroups Supervisor Symbol TokenUsers Tokens Transact Homepage Workshop)

install(
    FILES ${SERVICE_DIR}/index.json
          ${SERVICE_DIR}/Accounts.psi
          ${SERVICE_DIR}/Aes.psi
          ${SERVICE_DIR}/AuthAny.psi
          ${SERVICE_DIR}/AuthDelegate.psi
          ${SERVICE_DIR}/AuthSig.psi
          ${SERVICE_DIR}/Base64.psi
          ${SERVICE_DIR}/Branding.psi
          ${SERVICE_DIR}/BrotliCodec.psi
          ${SERVICE_DIR}/Chainmail.psi
          ${SERVICE_DIR}/ClientData.psi
          ${SERVICE_DIR}/CommonApi.psi
          ${SERVICE_DIR}/DevDefault.psi
          ${SERVICE_DIR}/ProdDefault.psi
          ${SERVICE_DIR}/CpuLimit.psi
          ${SERVICE_DIR}/Docs.psi
          ${SERVICE_DIR}/Events.psi
          ${SERVICE_DIR}/Evaluations.psi
          ${SERVICE_DIR}/Explorer.psi
          ${SERVICE_DIR}/Fractals.psi
          ${SERVICE_DIR}/HttpServer.psi
          ${SERVICE_DIR}/Homepage.psi
          ${SERVICE_DIR}/Identity.psi
          ${SERVICE_DIR}/Invite.psi
          ${SERVICE_DIR}/Kdf.psi
          ${SERVICE_DIR}/Minimal.psi
          ${SERVICE_DIR}/Nft.psi
          ${SERVICE_DIR}/Nop.psi
          ${SERVICE_DIR}/Packages.psi
          ${SERVICE_DIR}/Permissions.psi
          ${SERVICE_DIR}/Producers.psi
          ${SERVICE_DIR}/Profiles.psi
          ${SERVICE_DIR}/Registry.psi
          ${SERVICE_DIR}/SetCode.psi
          ${SERVICE_DIR}/Sites.psi
          ${SERVICE_DIR}/StagedTx.psi
          ${SERVICE_DIR}/Subgroups.psi
          ${SERVICE_DIR}/Supervisor.psi
          ${SERVICE_DIR}/SupervisorTests.psi
          ${SERVICE_DIR}/Symbol.psi
          ${SERVICE_DIR}/TestDefault.psi
          ${SERVICE_DIR}/Tokens.psi
          ${SERVICE_DIR}/TokenUsers.psi
          ${SERVICE_DIR}/Transact.psi
          ${SERVICE_DIR}/Workshop.psi
    DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/packages/
    COMPONENT ServerData)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/PSubjective.psi
    NAME PSubjective
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Test service for parallel access to the subjective database"
    SERVICE psubjective
        WASM ${CMAKE_CURRENT_BINARY_DIR}/PSubjectiveService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/PSubjectiveService-schema.json
        FLAGS isSubjective allowWriteSubjective
        SERVER psubjective
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/Counter.psi
    NAME Counter
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Test service than increments a counter"
    SERVICE counter
        WASM ${CMAKE_CURRENT_BINARY_DIR}/CounterService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/CounterService-schema.json
        SERVER counter
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/AsyncQuery.psi
    NAME AsyncQuery
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Test service for the various ways to respond to http requests"
    SERVICE as-query
        WASM ${CMAKE_CURRENT_BINARY_DIR}/AsyncQueryService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/AsyncQueryService-schema.json
        SERVER as-query
        POSTINSTALL ${CMAKE_CURRENT_SOURCE_DIR}/services/psibase_tests/AsyncQueryService.json
        FLAGS allowWriteSubjective
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/SubjectiveCounter.psi
    NAME SubjectiveCounter
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Test service that increments a counter in the subjective db"
    SERVICE s-counter
        WASM ${CMAKE_CURRENT_BINARY_DIR}/SubjectiveCounterService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/SubjectiveCounterService-schema.json
        SERVER s-counter
        FLAGS isSubjective allowWriteSubjective
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/KeepSocket.psi
    NAME KeepSocket
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Accepts HTTP requests, but never returns a response"
    SERVICE s-keep-sock
        WASM ${CMAKE_CURRENT_BINARY_DIR}/KeepSocketService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/KeepSocketService-schema.json
        SERVER s-keep-sock
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

psibase_package(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/test-packages/SocketList.psi
    NAME SocketList
    VERSION ${PSIBASE_VERSION}.0
    DESCRIPTION "Lists active sockets"
    SERVICE s-sock-list
        WASM ${CMAKE_CURRENT_BINARY_DIR}/SocketListService.wasm
        SCHEMA ${CMAKE_CURRENT_BINARY_DIR}/SocketListService-schema.json
        SERVER s-sock-list
        FLAGS allowNativeSubjective
    PACKAGE_DEPENDS "HttpServer(^${PSIBASE_VERSION}.0)"
    DEPENDS wasm
)

write_package_index(test-index ${CMAKE_CURRENT_BINARY_DIR}/test-packages PSubjective Counter AsyncQuery SubjectiveCounter KeepSocket SocketList)

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
    add_subdirectory(doc/src/development/services/cpp-service doc-examples)
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
