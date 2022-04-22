#pragma once

#include <stdlib.h>

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
};  // namespace psio
