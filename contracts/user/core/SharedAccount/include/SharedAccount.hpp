#pragma once
#include <algorithm>
#include <eosio/check.hpp>
#include <psibase/AccountNumber.hpp>

namespace psibase
{
   struct SharedAccount
   {
      SharedAccount() {}
      SharedAccount(const psibase::AccountNumber& a, const psibase::AccountNumber& b)
      {
         eosio::check(a.value != 0 && b.value != 0, "no shared account with the null account");
         auto [min, max] = std::minmax(a, b);
         partyA          = min;
         partyB          = max;
      }
      psibase::AccountNumber partyA;
      psibase::AccountNumber partyB;
   }

}  // namespace psibase