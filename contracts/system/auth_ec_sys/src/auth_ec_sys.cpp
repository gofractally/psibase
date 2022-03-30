#include <contracts/system/auth_ec_sys.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <psibase/crypto.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract
{
   //using table_num = uint16_t;
   static constexpr table_num auth_table = 1;

   inline auto auth_key(AccountNumber account)
   {
      return std::tuple{auth_ec_sys::contract, auth_table, account};
   }
   struct auth_row
   {
      AccountNumber account;
      PublicKey     pubkey;

      auto key() { return auth_key(account); }
   };
   PSIO_REFLECT(auth_row, account, pubkey)

   uint8_t auth_ec_sys::setKey(AccountNumber account, PublicKey key)
   {
      if (get_sender() != account)
      {
         psibase::actor<account_sys> asys(auth_ec_sys::contract, account_sys::contract);
         asys.create_account(account, auth_ec_sys::contract, false);
      }
      else
      {
         check(get_sender() == account, "wrong sender");
      }
      auth_row row{account, key};
      kv_put(row.key(), row);
      return 0;
   }

   uint8_t auth_ec_sys::authCheck(const_view<Action> act, const_view<std::vector<Claim>> claims)
   {
      if (enable_print)
         eosio::print("auth_check\n");

      auto row = kv_get<auth_row>(auth_key(act->sender()));
      check(!!row, "sender does not have a public key");
      return 0;
      /*
      auto expected = eosio::convert_to_bin(row->pubkey);
      for (auto& claim : args.claims)
         if (claim.contract == verify_ec_sys::contract && claim.raw_data == expected)
            return;
      abort_message("no matching claim found");
      */
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::auth_ec_sys)
