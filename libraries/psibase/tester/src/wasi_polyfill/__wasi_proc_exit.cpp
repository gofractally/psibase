#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" _Noreturn void POLYFILL_NAME(proc_exit)(__wasi_exitcode_t code)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("proc_exit")))
{
   [[clang::import_name("testerExit"), noreturn]] void testerExit(int32_t code);
   testerExit(code);
}
