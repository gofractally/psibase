#pragma once

#include <catch2/catch.hpp>
#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/rpc_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <iostream>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>
#include <psibase/tester.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   inline std::string show(bool include, transaction_trace t)
   {
      if (include || t.error)
         std::cout << pretty_trace(trim_raw_data(t)) << "\n";
      if (t.error)
         return *t.error;
      return {};
   }

   inline void installSystemContracts(test_chain& t, bool show = false)
   {
      auto trace = t.push_transaction(t.make_transaction(  //
          {                                                //
           action{
               .sender   = AccountNumber{"foo"},  // ignored
               .contract = AccountNumber{"bar"},  // ignored
               .method   = {},
               .raw_data = psio::convert_to_frac(genesis_action_data{
                   .contracts =  // g.a.d--^ is config file for gen
                   {
                       {
                           .contract      = system_contract::transaction_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = system_contract::transaction_sys::contract_flags,
                           .code          = read_whole_file("transaction_sys.wasm"),
                       },
                       {
                           .contract      = system_contract::account_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = system_contract::account_sys::contract_flags,
                           .code          = read_whole_file("account_sys.wasm"),
                       },
                       {
                           .contract      = system_contract::rpc_account_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = 0,
                           .code          = read_whole_file("rpc_sys.wasm"),
                       },
                       {
                           .contract      = system_contract::auth_fake_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = 0,
                           .code          = read_whole_file("auth_fake_sys.wasm"),
                       },
                       {
                           .contract      = system_contract::auth_ec_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = 0,
                           .code          = read_whole_file("auth_ec_sys.wasm"),
                       },
                       {
                           .contract      = system_contract::verify_ec_sys::contract,
                           .auth_contract = system_contract::auth_fake_sys::contract,
                           .flags         = 0,
                           .code          = read_whole_file("verify_ec_sys.wasm"),
                       },
                   },
               }),
           }}));

      eosio::check(psibase::show(show, trace) == "", "Failed to install genesis contracts");
   }

   inline void createSysContractAccounts(test_chain& t, bool show = false)
   {
      transactor<system_contract::account_sys> asys{system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract};

      auto trace = t.push_transaction(t.make_transaction(  //
          {asys.startup(std::vector<AccountNumber>{
              {system_contract::transaction_sys::contract},
              {system_contract::account_sys::contract},
              {rpcContractNum},
              {system_contract::auth_fake_sys::contract},
              {system_contract::auth_ec_sys::contract},
              {system_contract::verify_ec_sys::contract},
          })}));

      eosio::check(psibase::show(show, trace) == "", "Failed to create system contract accounts");
   }

   /* sets up a min functional chain with ec signatures 
    */
   inline void boot_minimal(test_chain& t, bool show = false)
   {
      installSystemContracts(t, show);
      createSysContractAccounts(t, show);
   }

   inline AccountNumber add_account(test_chain&   t,
                                    AccountNumber acc,
                                    AccountNumber auth_contract = AccountNumber("auth-fake-sys"),
                                    bool          show          = false)
   {
      transactor<system_contract::account_sys> asys(system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract);

      auto trace = t.push_transaction(  //
          t.make_transaction({asys.newAccount(acc, auth_contract, false)}));
      eosio::check(psibase::show(show, trace) == "", "Failed to add account");

      return acc;

   }  // add_account()

   inline AccountNumber add_account(test_chain&   t,
                                    const char*   acc,
                                    AccountNumber auth_contract = AccountNumber("auth-fake-sys"),
                                    bool          show          = false)
   {
      return add_account(t, AccountNumber(acc), auth_contract, show);
   }

   inline AccountNumber add_ec_account(test_chain&      t,
                                       AccountNumber    name,
                                       const PublicKey& public_key,
                                       bool             show = false)
   {
      auto trace = t.push_transaction(  //
          t.make_transaction(           //
              {{
                  .sender   = system_contract::transaction_sys::contract,
                  .contract = system_contract::auth_ec_sys::contract,
                  .raw_data = psio::convert_to_frac(system_contract::auth_ec_sys::action{
                      system_contract::auth_ec_sys::create_account{
                          .name       = name,
                          .public_key = public_key,
                      }}),
              }}));

      eosio::check(psibase::show(show, trace) == "", "Failed to add ec account");
      auto& at = get_top_action(trace, 0);
      return psio::convert_from_frac<AccountNumber>(at.raw_retval);
   }  // add_ec_account()

   inline AccountNumber add_ec_account(test_chain&      t,
                                       const char*      name,
                                       const PublicKey& public_key,
                                       bool             show = false)
   {
      return add_ec_account(t, AccountNumber(name), public_key, show);
   }

   inline AccountNumber add_contract(test_chain&   t,
                                     AccountNumber acc,
                                     const char*   filename,
                                     bool          show = false)
   {
      add_account(t, acc, AccountNumber("auth-fake-sys"), show);
      transactor<system_contract::transaction_sys> tsys{acc,
                                                        system_contract::transaction_sys::contract};

      auto trace = t.push_transaction(
          t.make_transaction({{tsys.setCode(acc, 0, 0, read_whole_file(filename))}}));

      eosio::check(psibase::show(show, trace) == "", "Failed to create contract");

      return acc;
   }  // add_contract()

   inline AccountNumber add_contract(test_chain& t,
                                     const char* acc,
                                     const char* filename,
                                     bool        show = false)
   {
      return add_contract(t, AccountNumber(acc), filename, show);
   }

}  // namespace psibase
