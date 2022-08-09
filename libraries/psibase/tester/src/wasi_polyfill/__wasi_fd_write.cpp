#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_write)(__wasi_fd_t            fd,
                                                  const __wasi_ciovec_t* iovs,
                                                  size_t                 iovs_len,
                                                  __wasi_size_t*         nwritten)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_write")))
{
   [[clang::import_name("testerWriteFile")]] uint32_t testerWriteFile(int32_t fd, const void* data,
                                                                      uint32_t size);
   if (nwritten)
      *nwritten = 0;
   for (; iovs_len; --iovs_len, ++iovs)
   {
      auto error = testerWriteFile(fd, iovs->buf, iovs->buf_len);
      if (error)
         return error;
      if (nwritten)
         *nwritten += iovs->buf_len;
   }
   return 0;
}
