# Targets and file paths the package zip rules expect, filled in by the Nix
# `pack` derivation. Nothing here compiles.
if(NOT PSIBASE_PLUGIN_DIR)
    message(FATAL_ERROR "PSIBASE_NIX_PACKAGE_ONLY requires -DPSIBASE_PLUGIN_DIR")
endif()
if(NOT PSIBASE_CARGO_PACKAGES)
    message(FATAL_ERROR "PSIBASE_NIX_PACKAGE_ONLY requires -DPSIBASE_CARGO_PACKAGES")
endif()

add_custom_target(wasm)
add_custom_target(doc)
add_custom_target(plugins-prebuilt)
add_custom_target(component-parser-prebuilt)
add_custom_target(CommonApiCommonLib_js)
add_custom_target(reserved-names)

set(Plugins_DEP plugins-prebuilt)
set(ComponentParser_DEP component-parser-prebuilt)
set(COMPONENT_BIN_DIR ${PSIBASE_PLUGIN_DIR})
set(ComponentParser_OUTPUT_FILE component_parser.wasm)

set(PSIBASE_PLUGIN_NAMES
    accounts accounts-query aes auth-any auth-none auth-delegate auth-sig
    base64 brotli-codec kdf kvtests setcode clientdata explorer invite
    packages permissions sites host-accounts host-client host-http host-db
    host-prompt host-types login-prompt host-auth host-crypto web-crypto
    transact transact-admin workshop fractal-core config homepage
    homepage-explorer producers
)
foreach(name ${PSIBASE_PLUGIN_NAMES})
    string(REPLACE "-" "_" var ${name})
    set(Plugins_OUTPUT_FILE_${var} ${COMPONENT_BIN_DIR}/${var}.wasm)
endforeach()
