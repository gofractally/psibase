#include <stdlib.h>
#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(clock_time_get)(__wasi_clockid_t    id,
                                                        __wasi_timestamp_t  precision,
                                                        __wasi_timestamp_t* time)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("clock_time_get")))
{
   [[clang::import_name("prints")]] void prints(const char*);
   prints("__wasi_clock_time_get not implemented");
   abort();
}
