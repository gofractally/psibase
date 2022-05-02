#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view invalidTokenId      = "Invalid token ID";
      constexpr std::string_view tokenDNE            = "Token DNE";
      constexpr std::string_view invalidAccount      = "Invalid account";
      constexpr std::string_view tokenUnrecallable   = "Token unrecallable";
      constexpr std::string_view manualDebitEnabled  = "ManualDebit already enabled";
      constexpr std::string_view maxSupplyExceeded   = "Max token supply exceeded";
      constexpr std::string_view tokenOverflow       = "Token overflow";
      constexpr std::string_view insufficientBalance = "Insufficient token balance";
      constexpr std::string_view supplyGt0           = "Max supply must be greater than 0";
      constexpr std::string_view quantityGt0         = "Quantity must be greater than 0";
   }  // namespace Errors
}  // namespace UserContract