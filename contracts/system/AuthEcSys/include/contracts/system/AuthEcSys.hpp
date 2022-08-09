#pragma once

#include <psibase/Contract.hpp>
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
      using AuthTable_t              = psibase::Table<AuthRecord, &AuthRecord::account>;
      using Tables = psibase::ContractTables<AuthTable_t, psibase::WebContentTable>;

      void checkAuthSys(psibase::Action             action,
                        std::vector<psibase::Claim> claims,
                        bool                        firstAuth,
                        bool                        readOnly);
      void setKey(psibase::PublicKey key);

     private:
      Tables db{contract};
   };
   PSIO_REFLECT(AuthEcSys,  //
                method(checkAuthSys, action, claims),
                method(setKey, key))
}  // namespace system_contract
