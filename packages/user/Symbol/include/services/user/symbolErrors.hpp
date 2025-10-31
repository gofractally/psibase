#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      constexpr std::string_view symbolDNE            = "Symbol does not exist";
      constexpr std::string_view symbolAlreadyExists  = "Symbol already exists";
      constexpr std::string_view priceTooLow          = "Symbol price below minimum";
      constexpr std::string_view creditSymbolRequired = "Symbol must be credited to symbol service";
      constexpr std::string_view buyerIsSeller        = "Buyer cannot be seller";
      constexpr std::string_view invalidSymbol =
          "Symbol may only contain 3 to 7 lowercase alphabetic characters";
      constexpr std::string_view symbolLengthNotSupported = "symbol length not supported";
   }  // namespace Errors
}  // namespace UserService
