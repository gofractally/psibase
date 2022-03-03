#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

namespace boot
{
   static constexpr psibase::account_num contract = 1;
   static constexpr uint64_t             contract_flags =
       psibase::account_row::allow_sudo | psibase::account_row::allow_write_native;

   using auth_check = psibase::action;

   struct set_code
   {
      using return_type = void;

      psibase::account_num contract;
      uint8_t              vm_type;
      uint8_t              vm_version;
      std::vector<char>    code;
   };
   EOSIO_REFLECT(set_code, contract, vm_type, vm_version, code)

   using action = std::variant<auth_check, set_code>;

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
}  // namespace boot
