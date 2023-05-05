#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_readdir)(__wasi_fd_t        fd,
                                                    uint8_t*           buf,
                                                    __wasi_size_t      buf_len,
                                                    __wasi_dircookie_t cookie,
                                                    __wasi_size_t*     retptr0)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_readdir")))
{
   abortMessage("__wasi_fd_readdir not implemented");
}
