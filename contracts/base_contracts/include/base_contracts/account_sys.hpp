#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>
#include <psio/fracpack.hpp>

namespace account_sys
{
   using psibase::account_num;
   static constexpr account_num contract       = 2;
   static constexpr uint64_t    contract_flags = psibase::account_row::allow_write_native;

   struct account_name
   {
      psibase::account_num num  = {};
      std::string          name = {};
   };
   PSIO_REFLECT(account_name, num, name );
   EOSIO_REFLECT(account_name, num, name );

   struct startup
   {
      using return_type = void;

      psibase::account_num      next_account_num  = 0;  // TODO: find this automatically
      std::vector<account_name> existing_accounts = {};

      static void run( account_num sender, 
                       psio::const_view<startup> data );
   };
   PSIO_REFLECT(startup, next_account_num, existing_accounts) 
   EOSIO_REFLECT(startup, next_account_num, existing_accounts) 

   struct create_account 
   {
      std::string name          = {};
      std::string auth_contract = {};  // TODO: use account_num? Presentation issues snuck in.
      bool        allow_sudo    = {};

      static account_num run( account_num sender, 
                              psio::const_view<create_account> data );
   };
   PSIO_REFLECT(create_account, name, auth_contract, allow_sudo)
   EOSIO_REFLECT(create_account, name, auth_contract, allow_sudo)

   struct get_account_by_name 
   {
      static std::optional<psibase::account_num> run( account_num sender, 
                                                      psio::const_view<get_account_by_name> data );

      std::string name = {};
   };
   PSIO_REFLECT(get_account_by_name, name)
   EOSIO_REFLECT(get_account_by_name, name)

   struct get_account_by_num 
   {
      static std::optional<std::string> run( account_num sender,
                                             psio::const_view<get_account_by_num> data );

      psibase::account_num num = {};
   };
   PSIO_REFLECT(get_account_by_num, num)
   EOSIO_REFLECT(get_account_by_num, num)

   using action = std::variant<startup, create_account, get_account_by_name, get_account_by_num>;

   /* other contracts include this header, and then call this function in order to
    * dispatch actions to this contract... tempoary until real dispatcher is in place 
    */
   template <typename T, typename R = decltype(result_of(&T::run)) >
   R call(psibase::account_num sender, T&& args)
   {
      auto result = psibase::call(psibase::action{ // not account_sys::action
          .sender   = sender,
          .contract = account_sys::contract, 
          // TODO: remove name conflicts between action types
          .raw_data = psio::convert_to_frac( account_sys::action( std::forward<T>(args) ) )
      });
      if constexpr (!std::is_same_v<R, void>) {
      //   return eosio::convert_from_bin<R>(result);
          return psio::convert_from_frac<R>(result);
      }
   }


   /*
   proxy
   dispatcher
   rpc
   contract<>
   actor<account_sys::action> 
   caller<action> d(sender_self, receiver);
   d.run<get_account_by_name>( anything that goes to constructor of get_account_by_name )
   */
}  // namespace account_sys
