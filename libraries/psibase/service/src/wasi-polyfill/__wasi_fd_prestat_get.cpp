#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_prestat_get)(__wasi_fd_t fd, __wasi_prestat_t* buf)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_prestat_get")))
{
   return __WASI_ERRNO_BADF;
}
