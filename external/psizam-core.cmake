# Native engine subset only. The high-level runtime/component facade depends on
# the new psio and must not enter the legacy-wire node's include or link image.
set(PSIBASE_PSIZAM_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/psizam")
if(NOT EXISTS "${PSIBASE_PSIZAM_SOURCE_DIR}/include/psizam/backend.hpp")
    message(FATAL_ERROR "Initialize the pinned external/psizam submodule")
endif()
if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|X86_64|amd64|AMD64|arm64|aarch64)$")
    message(FATAL_ERROR "The native psizam policy requires x86_64 or AArch64")
endif()
add_subdirectory("${PSIBASE_PSIZAM_SOURCE_DIR}/external" psizam-external)
add_library(psibase-psizam STATIC
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/runtime_helpers.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_runtime_helpers.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/call_on_stack.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/eh_runtime.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/debug/dwarf.cpp")
target_include_directories(psibase-psizam PUBLIC
    "${PSIBASE_PSIZAM_SOURCE_DIR}/include"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/external/ucc/include")
target_compile_definitions(psibase-psizam PUBLIC PSIZAM_SOFTFLOAT PSIZAM_DISABLE_EH)
target_compile_options(psibase-psizam PUBLIC
    $<$<COMPILE_LANG_AND_ID:CXX,Clang,AppleClang>:-fbracket-depth=1024>)
target_link_libraries(psibase-psizam PUBLIC softfloat)
