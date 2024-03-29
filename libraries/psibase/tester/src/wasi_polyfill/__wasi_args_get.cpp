#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(args_get)(uint8_t** argv, uint8_t* argv_buf)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("args_get")))
{
   [[clang::import_name("testerGetArgs")]] void testerGetArgs(uint8_t * *argv, uint8_t * argv_buf);
   testerGetArgs(argv, argv_buf);
   return 0;
}
