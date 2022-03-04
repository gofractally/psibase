#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

namespace account
{
   static constexpr psibase::account_num contract       = 2;
   static constexpr uint64_t             contract_flags = psibase::account_row::allow_write_native;

   struct account_name
   {
      psibase::account_num num  = {};
      std::string          name = {};
   };
   EOSIO_REFLECT(account_name, num, name)

   struct startup
   {
      using return_type = void;

      psibase::account_num      next_account_num  = 0;  // TODO: find this automatically
      std::vector<account_name> existing_accounts = {};
   };
   EOSIO_REFLECT(startup, next_account_num, existing_accounts)

   struct create_account
   {
      using return_type = psibase::account_num;

      std::string name          = {};
      std::string auth_contract = {};
      bool        allow_sudo    = {};
   };
   EOSIO_REFLECT(create_account, name, auth_contract, allow_sudo)

   struct get_by_name
   {
      using return_type = std::optional<psibase::account_num>;

      std::string name = {};
   };
   EOSIO_REFLECT(get_by_name, name)

   struct get_by_num
   {
      using return_type = std::optional<std::string>;

      psibase::account_num num = {};
   };
   EOSIO_REFLECT(get_by_num, num)

   using action = std::variant<startup, create_account, get_by_name, get_by_num>;

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
}  // namespace account
