#include <wasi/api.h>
#include "polyfill.hpp"

extern "C" __wasi_errno_t POLYFILL_NAME(random_get)(uint8_t* buf, __wasi_size_t len)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("random_get")))
{
   [[clang::import_name("getRandom")]] void getRandom(void* buf, std::uint32_t len);
   getRandom(buf, len);
   return 0;
}
