# XWebRtcSig test registration (CMake / ctest)
#
# Unit tests: Rust `#[test]` modules in `service/src/**` via cargo-psibase.
# These are fast and are part of the default ctest suite.
#
# E2E / integration (intentionally NOT registered — too slow for default CI):
#   - tests/python/test_xwebrtcsig.py  (~30 websocket/signaling cases + aiortc P2P)
#   - tests/python/chat_data_p2p_aiortc.py  (harness imported by the above)
# Homepage Playwright Chat/Meet specs under packages/user/Homepage/ui/e2e/
# are likewise not wired here; see webrtc-test-plan.md at the repo root.
#
# Manual Python e2e (from a built tree):
#   PYTHONPATH=<repo>/programs/psinode/tests \
#   PSIBASE_PACKAGE_DIR=<build>/share/psibase/packages \
#   python tests/python/test_xwebrtcsig.py --psinode=<build>/psinode

if(NOT DEFINED ROOT_BINARY_DIR)
    return()
endif()

# Prefer the native packages build (this subdirectory is always processed).
# Skip the nested IS_WASM packages pass to avoid duplicate ctest names.
if(DEFINED IS_WASM)
    return()
endif()

if(EXISTS "${ROOT_BINARY_DIR}/rust/release/cargo-psibase")
    add_test(
        NAME rs-test-XWebRtcSig
        COMMAND ${ROOT_BINARY_DIR}/rust/release/cargo-psibase test
            --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/service/Cargo.toml
            --target-dir ${LOCAL_WORKSPACE_TARGET}
            --psitest=${ROOT_BINARY_DIR}/psitest
    )
endif()
