#pragma once

#include <stdexcept>
#include <string_view>

namespace psio
{
   /**
     *  On some platforms we need to disable
     *  exceptions and do something else, this
     *  wraps that.
     */
   // TODO: MAJOR: this ends up throwing enums, const char*'s, and other
   //              things not derived from std::exception
   template <typename T>
   [[noreturn]] void throw_error(T&& e)
   {
#ifdef __cpp_exceptions
      throw e;
#else
      abort();
#endif
   }

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
