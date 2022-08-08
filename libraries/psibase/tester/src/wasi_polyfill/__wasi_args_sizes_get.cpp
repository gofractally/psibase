#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(args_sizes_get)(__wasi_size_t* argc,
                                                        __wasi_size_t* argv_buf_size)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("args_sizes_get")))
{
   static_assert(sizeof(__wasi_size_t) == sizeof(uint32_t));
   [[clang::import_name("testerGetArgCounts")]] void testerGetArgCounts(
       __wasi_size_t * argc, __wasi_size_t * argv_buf_size);
   testerGetArgCounts(argc, argv_buf_size);
   return 0;
}
