#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view missingRequiredAuth = "Missing required authority";
      constexpr std::string_view uninitialized       = "Contract not initialized";
      constexpr std::string_view alreadyInit         = "Contract already initialized";
   }  // namespace Errors
}  // namespace UserContract