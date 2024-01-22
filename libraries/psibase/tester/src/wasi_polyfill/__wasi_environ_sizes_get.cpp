#include <wasi/api.h>
#include "polyfill.hpp"

#include <stdio.h>

extern "C" __wasi_errno_t POLYFILL_NAME(environ_sizes_get)(__wasi_size_t* environc,
                                                           __wasi_size_t* environ_buf_size)
    __attribute__((__import_module__("wasi_snapshot_preview1"),
                   __import_name__("environ_sizes_get")))
{
   [[clang::import_name("testerGetEnvironCounts")]] __wasi_errno_t testerGetEnvironCounts(
       __wasi_size_t*, __wasi_size_t*);
   return testerGetEnvironCounts(environc, environ_buf_size);
}
