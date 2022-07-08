#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view missingRequiredAuth = "Missing required authority";
      constexpr std::string_view uninitialized       = "Contract not initialized";
      constexpr std::string_view alreadyInit         = "Contract already initialized";
      constexpr std::string_view invalidAccount      = "Invalid account";
      constexpr std::string_view accountAlreadyExists = "Invalid account";

   }  // namespace Errors
}  // namespace UserContract