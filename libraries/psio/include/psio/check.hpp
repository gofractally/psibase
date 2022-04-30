#pragma once

#include <stdexcept>
#include <string_view>

#ifdef COMPILING_WASM
#include <psibase/check.hpp>
#endif

namespace psio
{
   inline std::string_view error_to_str(std::string_view msg)
   {
      return msg;
   }

   template <typename T>
   [[noreturn]] void abort_error(const T& msg)
   {
#ifdef __cpp_exceptions
      throw std::runtime_error((std::string)error_to_str(msg));
#else
      psibase::abort_message_str(error_to_str(msg));
#endif
   }

   template <typename T>
   void check(bool cond, const T& msg)
   {
      if (!cond)
         abort_error(msg);
   }
};  // namespace psio
