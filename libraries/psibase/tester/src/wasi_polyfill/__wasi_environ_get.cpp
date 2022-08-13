#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(environ_get)(uint8_t** environ, uint8_t* environ_buf)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("environ_get")))
{
   [[clang::import_name("prints")]] void                prints(const char*);
   [[clang::import_name("testerAbort"), noreturn]] void testerAbort();
   prints("__wasi_environ_get not implemented");
   testerAbort();
}
