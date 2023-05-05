#pragma once

// WASI doesn't provide a version macro, so distinguish by fingerprinting the library
#if __has_include(<wasi/libc-nocwd.h>)
#define WASI_VERSION 13
#else
#define WASI_VERSION 12
#endif

#if WASI_VERSION >= 13
#define POLYFILL_NAME(x) __imported_wasi_snapshot_preview1_##x
#else
#define POLYFILL_NAME(x) __wasi_##x
#endif

#include <string_view>

inline namespace psibase_polyfill
{

   [[noreturn]] inline void abortMessage(std::string_view message)
   {
      [[clang::import_name("abortMessage")]] [[noreturn]] void abortMessage(const char* message,
                                                                            uint32_t    len);
      abortMessage(message.data(), message.size());
   }

}  // namespace psibase_polyfill
