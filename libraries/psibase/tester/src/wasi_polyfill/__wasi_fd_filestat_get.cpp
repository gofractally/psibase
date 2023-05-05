#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_filestat_get)(__wasi_fd_t fd, __wasi_filestat_t* stat)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_filestat_get")))
{
   [[clang::import_name("testerFdFilestatGet")]] __wasi_errno_t testerFdFilestatGet(
       __wasi_fd_t fd, void* stat, size_t statsize);
   return testerFdFilestatGet(fd, stat, sizeof(*stat));
}
