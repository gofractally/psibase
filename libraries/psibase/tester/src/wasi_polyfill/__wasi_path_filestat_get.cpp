#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(path_filestat_get)(__wasi_fd_t          fd,
                                                           __wasi_lookupflags_t flags,
                                                           const char*          path,
                                                           int32_t              pathlen,
                                                           __wasi_filestat_t*   stat)
    __attribute__((__import_module__("wasi_snapshot_preview1"),
                   __import_name__("path_filestat_get")))
{
   [[clang::import_name("prints")]] void                prints(const char*);
   [[clang::import_name("testerAbort"), noreturn]] void testerAbort();
   prints("__wasi_path_filestat_get not implemented");
   testerAbort();
}
