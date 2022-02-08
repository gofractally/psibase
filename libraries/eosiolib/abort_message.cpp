#include <stdint.h>
#include <string.h>

[[clang::import_name("prints_l")]] extern "C" void prints_l(const char*, uint32_t);

[[noreturn]] extern "C" void abort();

// Replace libc++abi abort_message, which pulls in *printf
[[noreturn]] extern "C" void abort_message(const char* msg, ...)
{
   prints_l(msg, strlen(msg));
   abort();
}
