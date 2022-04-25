#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view invalidTokenId      = "Invalid token ID";
      constexpr std::string_view invalidAccount      = "Invalid account";
      constexpr std::string_view tokenUnrecallable   = "Token unrecallable";
      constexpr std::string_view insufficientBalance = "Insufficient balance";
      constexpr std::string_view autodebitDisabled   = "Autodebit already disabled";
   }  // namespace Errors
}  // namespace UserContract