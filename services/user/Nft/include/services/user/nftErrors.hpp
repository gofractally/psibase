#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      constexpr std::string_view nftDNE              = "NFT does not exist";
      constexpr std::string_view invalidNftId        = "NFT ID invalid";
      constexpr std::string_view debitRequiresCredit = "Nothing to debit. Must first be credited.";
      constexpr std::string_view uncreditRequiresCredit = "Nothing to uncredit. Must first credit.";
      constexpr std::string_view creditorIsDebitor      = "Creditor and debitor cannot be the same";
      constexpr std::string_view creditorAction  = "Only the creditor may perform this action";
      constexpr std::string_view receiverDNE     = "Receiver DNE";
      constexpr std::string_view alreadyCredited = "NFT already credited to an account";
      constexpr std::string_view redundantUpdate = "Specified update is redundant";
      constexpr std::string_view nftBurned       = "NFT was burned";
   }  // namespace Errors
}  // namespace UserService
