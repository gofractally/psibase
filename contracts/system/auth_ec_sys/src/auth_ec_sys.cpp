#include <contracts/system/auth_ec_sys.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <psibase/actor.hpp>
#include <psibase/crypto.hpp>
#include <psibase/native_tables.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract::auth_ec_sys
{
   using table_num                       = uint32_t;
   static constexpr table_num auth_table = 1;

   inline auto auth_key(AccountNumber account)
   {
      return std::tuple{contract, auth_table, account};
   }
   struct auth_row
   {
      AccountNumber account;
      PublicKey     pubkey;

      auto key() { return auth_key(account); }
   };
   PSIO_REFLECT(auth_row, account, pubkey)

   void exec(AccountNumber this_contract, AccountNumber sender, auth_check& args)
   {
      if (enable_print)
         print("auth_check\n");
      auto row = kvGet<auth_row>(auth_key(args.action.sender));
      check(!!row, "sender does not have a public key");
      auto expected = psio::convert_to_frac(row->pubkey);
      for (auto& claim : args.claims)
         if (claim.contract == verify_ec_sys::contract && claim.rawData == expected)
            return;
      abortMessage("no matching claim found");
   }

   void exec(AccountNumber this_contract, AccountNumber sender, set_key& args)
   {
      check(sender == args.account, "wrong sender");
      auth_row row{args.account, args.key};
      kvPut(row.key(), row);
   }

   AccountNumber exec(AccountNumber this_contract, AccountNumber sender, create_account& args)
   {
      writeConsole("account_sys::create_account");
      psibase::actor<account_sys> asys(this_contract, account_sys::contract);
      asys.newAccount(args.name, this_contract, true);
      auth_row row{AccountNumber{args.name}, args.public_key};
      kvPut(row.key(), row);
      return args.name;
   }

   extern "C" void called(AccountNumber this_contract, AccountNumber sender)
   {
      // printf("called this_contract=%d, sender=%d\n", this_contract, sender);
      auto act  = getCurrentAction();
      auto data = psio::convert_from_frac<action>(act.rawData);
      std::visit(
          [&](auto& x)
          {
             if constexpr (std::is_same_v<decltype(exec(this_contract, sender, x)), void>)
                exec(this_contract, sender, x);
             else
                setRetval(exec(this_contract, sender, x));
          },
          data);
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(AccountNumber this_contract)
   {
      __wasm_call_ctors();
   }
}  // namespace system_contract::auth_ec_sys
