#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(clock_time_get)(__wasi_clockid_t    id,
                                                        __wasi_timestamp_t  precision,
                                                        __wasi_timestamp_t* time)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("clock_time_get")))
{
   [[clang::import_name("clockTimeGet")]] int32_t clockTimeGet(uint32_t id, uint64_t * time);
   return clockTimeGet(id, time);
}
