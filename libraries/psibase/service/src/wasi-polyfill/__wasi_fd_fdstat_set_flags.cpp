#include <stdlib.h>
#include <wasi/api.h>
#include "polyfill.hpp"

#include <stdio.h>

extern "C" __wasi_errno_t POLYFILL_NAME(fd_fdstat_set_flags)(__wasi_fd_t fd, __wasi_fdflags_t flags)
    __attribute__((__import_module__("wasi_snapshot_preview1"),
                   __import_name__("fd_fdstat_set_flags")))
{
   [[clang::import_name("prints")]] void prints(const char*);
   prints("__wasi_fd_fdstat_set_flags not implemented");
   abort();
}
