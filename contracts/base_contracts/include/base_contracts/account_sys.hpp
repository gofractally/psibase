#pragma once
#include <psibase/intrinsic.hpp>
#include <psibase/actor.hpp>
#include <psibase/native_tables.hpp>

namespace psibase 
{
   using psibase::account_num_type;
   using std::string;
   using std::vector;
   using std::optional;

   template<typename T>
   using const_view = psio::const_view<T>;


   struct account_name
   {
      account_num_type num;
      string           name;
   };
   PSIO_REFLECT(account_name, num, name );
   EOSIO_REFLECT(account_name, num, name );

   class account_sys: public psibase::contract {
      public:
         static constexpr account_num_type  contract = 2; /// hard coded...?
         static constexpr uint64_t    contract_flags = psibase::account_row::allow_write_native;

         void startup( account_num_type next_account_num,
                       const_view<vector<account_name>> existing_accounts );
         
         account_num_type           create_account( const_view<string> name, 
                                                    const_view<string> auth_contract,
                                                    bool allow_sudo );

         optional<account_num_type> get_account_by_name( const_view<string> name );

         optional<string>           get_account_by_num( account_num_type num );
         void assert_account_name( account_num_type num, const_view<string> name );
   };

   PSIO_REFLECT_INTERFACE( account_sys, 
       (startup,             0, next_account_num, existing_accounts),
       (create_account,      1, name, auth_contract ),
       (get_account_by_name, 2, name ),
       (get_account_by_num,  3, num  ),
       (assert_account_name, 4, num, name)
   )

}  // namespace psibase
