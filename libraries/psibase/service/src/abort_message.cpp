#include <stdint.h>
#include <string.h>

extern "C" [[clang::import_name("writeConsole")]] void writeConsole(const char*, uint32_t);

extern "C" [[noreturn]] void abort();

// Replace libc++abi abort_message, which pulls in *printf
extern "C" [[noreturn]] void abort_message(const char* msg, ...)
{
   writeConsole(msg, strlen(msg));
   abort();
}
