#pragma once

#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>
#include <psibase/actor.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   using psibase::AccountNumber;

   class transaction_sys : public psibase::contract
   {
     public:
      static constexpr AccountNumber contract = AccountNumber("transact-sys");
      static constexpr uint64_t      contract_flags =
          psibase::account_row::allow_sudo | psibase::account_row::allow_write_native;

      uint8_t setCode(AccountNumber     contract,
                      uint8_t           vm_type,
                      uint8_t           vm_version,
                      std::vector<char> code);
   };

   PSIO_REFLECT_INTERFACE(transaction_sys, (setCode, 0, contact, vm_type, vm_version, code))
}  // namespace system_contract
