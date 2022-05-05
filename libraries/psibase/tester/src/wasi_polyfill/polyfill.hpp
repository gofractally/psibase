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
