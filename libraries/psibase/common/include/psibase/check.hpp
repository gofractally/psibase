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
   // with other libraries.
   namespace raw
   {
      /// Abort with `message`
      ///
      /// Message should be UTF8.
      PSIBASE_INTRINSIC(abortMessage)
      [[noreturn]] void abortMessage(const char* message, uint32_t len);
   }  // namespace raw

   /// Abort with `message`
   ///
   /// Message should be UTF8.
   [[noreturn]] inline void abortMessage(std::string_view message)
   {
#ifdef COMPILING_WASM
      raw::abortMessage(message.data(), message.size());
#else
      throw std::runtime_error((std::string)message);
#endif
   }

   /// Abort with message if `!cond`
   ///
   /// Message should be UTF8.
   inline void check(bool cond, std::string_view message)
   {
      if (!cond)
         abortMessage(message);
   }
}  // namespace psibase

#undef PSIBASE_INTRINSIC
