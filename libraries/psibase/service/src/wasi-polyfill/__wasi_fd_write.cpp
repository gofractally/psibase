#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_write)(__wasi_fd_t            fd,
                                                  const __wasi_ciovec_t* iovs,
                                                  size_t                 iovs_len,
                                                  __wasi_size_t*         nwritten)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_write")))
{
   [[clang::import_name("writeConsole")]] void writeConsole(const void*, uint32_t);
   if (nwritten)
      *nwritten = 0;
   for (; iovs_len; --iovs_len, ++iovs)
   {
      writeConsole(iovs->buf, iovs->buf_len);
      if (nwritten)
         *nwritten += iovs->buf_len;
   }
   return 0;
}
