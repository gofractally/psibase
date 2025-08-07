#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      constexpr std::string_view invalidTokenId       = "Invalid token ID";
      constexpr std::string_view tokenDNE             = "Token DNE";
      constexpr std::string_view tokenUnrecallable    = "Token unrecallable";
      constexpr std::string_view maxSupplyExceeded    = "Max issued supply exceeded";
      constexpr std::string_view tokenOverflow        = "Token overflow";
      constexpr std::string_view insufficientBalance  = "Insufficient token balance";
      constexpr std::string_view missingSharedBalance = "Shared balance does not exist";
      constexpr std::string_view supplyGt0            = "Max issued supply must be greater than 0";
      constexpr std::string_view quantityGt0          = "Quantity must be greater than 0";
      constexpr std::string_view noMappedSymbol       = "Token has no mapped symbol";
      constexpr std::string_view tokenHasSymbol       = "Token already has a symbol";
      constexpr std::string_view wrongSysTokenId      = "System token must have TID: 1";
      constexpr std::string_view invalidConfigUpdate  = "Invalid configuration update";
      constexpr std::string_view tokenUntradeable     = "Token untradeable";
      constexpr std::string_view senderIsReceiver     = "Sender cannot be receiver";
   }  // namespace Errors
}  // namespace UserService