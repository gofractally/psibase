#pragma once
#include <psibase/actor.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/name.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract 
{
   using namespace psibase;
   using std::optional;
   using std::string;
   using std::vector;
   using psio::const_view;

   class account_sys : public psibase::contract
   {
     public:
      static constexpr AccountNumber contract = AccountNumber("account-sys");
      static constexpr uint64_t      contract_flags = psibase::account_row::allow_write_native;
      static constexpr AccountNumber null_account;

      uint8_t startup( const_view<vector<AccountNumber>> existing_accounts);
      uint8_t create_account( AccountNumber account, AccountNumber auth_contract, bool allow_sudo);
      uint8_t exists( AccountNumber num);
   };

   PSIO_REFLECT_INTERFACE(account_sys,
                          (startup, 0, existing_accounts),
                          (create_account, 1, name, auth_contract, allow_sudo),
                          (exists, 2, num))

}  // namespace system_contract
