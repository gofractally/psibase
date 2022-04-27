#pragma once

#include <stdexcept>
#include <string_view>

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
      // TODO: discards msg
      // error_to_str() temporarily just verifies compilation
      error_to_str(msg);
      abort();
#endif
   }

   template <typename T>
   void check(bool cond, const T& msg)
   {
      if (!cond)
         abort_error(msg);
   }
};  // namespace psio
