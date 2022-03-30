#pragma once

#include <psibase/actor.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

namespace system_contract
{
   using psibase::AccountNumber;

   class transaction_sys : public psibase::contract {
      public:
         static constexpr AccountNumber contract       = AccountNumber("transact-sys");
         static constexpr uint64_t      contract_flags = psibase::account_row::allow_sudo | 
                                                         psibase::account_row::allow_write_native;

         uint8_t setCode( AccountNumber contract, uint8_t vm_type, uint8_t vm_version,
                          std::vector<char>  code );
   };

   PSIO_REFLECT_INTERFACE( transaction_sys, 
                           (setCode, 0, contact, vm_type, vm_version, code) )

      /*
   struct set_code
   {
      using return_type = void;

      AccountNumber        contract;
      uint8_t              vm_type;
      uint8_t              vm_version;
      std::vector<char>    code;
   };
   PSIO_REFLECT(set_code, contract, vm_type, vm_version, code)

   using action = std::variant<set_code>;

   template <typename T, typename R = typename T::return_type>
   R call(psibase::account_num sender, T args)
   {
      auto result = psibase::call(psibase::action{
          .sender   = sender,
          .contract = contract,
          .raw_data = eosio::convert_to_bin(action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return eosio::convert_from_bin<R>(result);
   }
   */
}  // namespace system
