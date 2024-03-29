#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(fd_read)(__wasi_fd_t           fd,
                                                 const __wasi_iovec_t* iovs,
                                                 size_t                iovs_len,
                                                 __wasi_size_t*        nread)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("fd_read")))
{
   [[clang::import_name("testerReadFile")]] uint32_t testerReadFile(
       int32_t fd, const void* data, uint32_t size, uint32_t& bytes_read);
   if (nread)
      *nread = 0;
   for (; iovs_len; --iovs_len, ++iovs)
   {
      uint32_t bytes_read = 0;
      auto     error      = testerReadFile(fd, iovs->buf, iovs->buf_len, bytes_read);
      if (error)
         return error;
      if (nread)
         *nread += bytes_read;
      if (bytes_read < iovs->buf_len)
         return 0;
   }
   return 0;
}
