#pragma once
#include <psibase/Contract.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   class account_sys : public psibase::Contract<account_sys>
   {
     public:
      static constexpr auto                   contract      = psibase::AccountNumber("account-sys");
      static constexpr uint64_t               contractFlags = psibase::AccountRow::allowWriteNative;
      static constexpr psibase::AccountNumber nullAccount   = psibase::AccountNumber(0);

      void startup(psio::const_view<std::vector<psibase::AccountNumber>> existing_accounts);
      void newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authContract,
                      bool                   requireNew);
      bool exists(psibase::AccountNumber num);

      struct Events
      {
         struct History
         {
         };
         struct Ui
         {
         };
         struct Merkle
         {
         };
      };
      // using Database = Tables<>
   };

   PSIO_REFLECT(account_sys,
                method(startup, existing_accounts),
                method(newAccount, name, authContract, requireNew),
                method(exists, num))
}  // namespace system_contract
