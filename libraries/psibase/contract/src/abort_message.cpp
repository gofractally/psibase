#include <stdint.h>
#include <string.h>

[[clang::import_name("writeConsole")]] extern "C" void writeConsole(const char*, uint32_t);

[[noreturn]] extern "C" void abort();

// Replace libc++abi abort_message, which pulls in *printf
[[noreturn]] extern "C" void abort_message(const char* msg, ...)
{
   writeConsole(msg, strlen(msg));
   abort();
}
