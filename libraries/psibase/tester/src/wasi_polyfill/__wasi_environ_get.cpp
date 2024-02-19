#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(environ_get)(uint8_t** environ, uint8_t* environ_buf)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("environ_get")))
{
   [[clang::import_name("testerGetEnviron")]] __wasi_errno_t testerGetEnviron(uint8_t**, uint8_t*);
   return testerGetEnviron(environ, environ_buf);
}
