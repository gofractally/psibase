#pragma once

#include <string>
#include <string_view>

#ifdef COMPILING_WASM
#define PSIBASE_INTRINSIC(x) [[clang::import_name(#x)]]
#else
#include <stdexcept>
#define PSIBASE_INTRINSIC(x)
#endif

namespace psibase
{
   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries. e.g. libc++'s abort_message
   namespace raw
   {
      // Abort with message. Message should be UTF8.
      PSIBASE_INTRINSIC(abort_message)
      [[noreturn]] void abort_message(const char* message, uint32_t len);
   }  // namespace raw

   // Abort with message. Message should be UTF8.
   [[noreturn]] inline void abort_message_str(std::string_view message)
   {
#ifdef COMPILING_WASM
      raw::abort_message(message.data(), message.size());
#else
      throw std::runtime_error((std::string)message);
#endif
   }

   // Abort with message if !cond. Message should be UTF8.
   inline void check(bool cond, std::string_view message)
   {
      if (!cond)
         abort_message_str(message);
   }
}  // namespace psibase

#undef PSIBASE_INTRINSIC
