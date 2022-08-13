#pragma once

#include <contracts/system/TransactionSys.hpp>
#include <psibase/Table.hpp>
#include <psibase/crypto.hpp>
#include <psibase/serveContent.hpp>

namespace system_contract
{
   struct AuthRecord
   {
      psibase::AccountNumber account;
      psibase::PublicKey     pubkey;
   };
   PSIO_REFLECT(AuthRecord, account, pubkey)

   class AuthEcSys : public psibase::Contract<AuthEcSys>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("auth-ec-sys");
      using AuthTable = psibase::Table<AuthRecord, &AuthRecord::account, &AuthRecord::pubkey>;
      using Tables    = psibase::ContractTables<AuthTable>;

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ContractMethod> allowedActions,
                        std::vector<psibase::Claim> claims);
      void newAccount(psibase::AccountNumber account, psibase::PublicKey payload);
      void setKey(psibase::PublicKey key);

     private:
      Tables db{contract};
   };
   PSIO_REFLECT(AuthEcSys,  //
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(setKey, key),
                method(newAccount, account, payload)
                //
   )
}  // namespace system_contract
