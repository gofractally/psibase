#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view symbolDNE         = "Symbol does not exist";
      constexpr std::string_view symbolUnavailable = "Symbol unavailable";
   }  // namespace Errors
}  // namespace UserContract