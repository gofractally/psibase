#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(environ_sizes_get)(__wasi_size_t* environc,
                                                           __wasi_size_t* environ_buf_size)
    __attribute__((__import_module__("wasi_snapshot_preview1"),
                   __import_name__("environ_sizes_get")))
{
   *environc         = 0;
   *environ_buf_size = 0;
   return 0;
}
