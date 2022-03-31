#pragma once
#include <psibase/actor.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/name.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   using namespace psibase;
   using psio::const_view;
   using std::optional;
   using std::string;
   using std::vector;

   class account_sys : public psibase::contract
   {
     public:
      static constexpr AccountNumber contract       = AccountNumber("account-sys");
      static constexpr uint64_t      contract_flags = psibase::account_row::allow_write_native;
      static constexpr AccountNumber null_account;

      void startup(const_view<vector<AccountNumber>> existing_accounts);
      void newAccount(AccountNumber account, AccountNumber auth_contract, bool allow_sudo);
      bool exists(AccountNumber num);
   };

   PSIO_REFLECT_INTERFACE(account_sys,
                          (startup, 0, existing_accounts),
                          (newAccount, 1, name, auth_contract, allow_sudo),
                          (exists, 2, num))

}  // namespace system_contract
