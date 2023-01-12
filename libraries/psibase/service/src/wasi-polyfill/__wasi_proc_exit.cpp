#include <stdlib.h>
#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" _Noreturn void POLYFILL_NAME(proc_exit)(__wasi_exitcode_t code)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("proc_exit")))
{
   [[clang::import_name("prints")]] void prints(const char*);
   prints("__wasi_proc_exit not implemented");
   abort();
}
