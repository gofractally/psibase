#pragma once

#include <string_view>

namespace newchain
{
   namespace intrinsic
   {
      [[clang::import_name("abort_message"), noreturn]] void abort_message(const char* msg,
                                                                           uint32_t    len);
   }

   [[noreturn]] inline void abort_message(std::string_view msg)
   {
      intrinsic::abort_message(msg.data(), msg.size());
   }

   inline void check(bool cond, std::string_view msg)
   {
      if (!cond)
         abort_message(msg);
   }
}  // namespace newchain
