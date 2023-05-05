#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_close)(__wasi_fd_t fd)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_close")))
{
   abortMessage("__wasi_fd_close not implemented");
}
