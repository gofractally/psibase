#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      constexpr std::string_view missingRequiredAuth = "Missing required authority";
      constexpr std::string_view uninitialized       = "Service not initialized";
      constexpr std::string_view alreadyInit         = "Service already initialized";
      constexpr std::string_view invalidAccount      = "Invalid account";
   }  // namespace Errors
}  // namespace UserService