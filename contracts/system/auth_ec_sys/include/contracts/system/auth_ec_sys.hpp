#pragma once

#include <psibase/Contract.hpp>

namespace system_contract
{
   struct AuthEcSys : psibase::Contract<AuthEcSys>
   {
      static constexpr auto contract = psibase::AccountNumber("auth-ec-sys");

      void checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims);
      void setKey(psibase::AccountNumber account, psibase::PublicKey key);

      // TODO: remove. This is just a temporary approach for creating an account with a key.
      psibase::AccountNumber createAccount(psibase::AccountNumber name,
                                           psibase::PublicKey     publicKey);
   };
   PSIO_REFLECT(AuthEcSys,  //
                method(checkAuthSys, action, claims),
                method(setKey, account, key),
                method(createAccount, name, publicKey))
}  // namespace system_contract
