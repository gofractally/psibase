#pragma once

#include <catch2/catch.hpp>
#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
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

   inline const action_trace& get_top_action(transaction_trace& t, size_t num)
   {
      // TODO: redesign transaction_trace to make this easier
      // Current layout:
      //    verify proof 0
      //    verify proof 1
      //    ...
      //    transaction.sys (below is interspersed with events, console, etc. in execution order)
      //        check_auth
      //        action 0
      //        check_auth
      //        action 1
      //        ...
      eosio::check(!t.action_traces.empty(), "transaction_trace has no actions");
      auto&                            root = t.action_traces.back();
      std::vector<const action_trace*> top_traces;
      for (auto& inner : root.inner_traces)
         if (std::holds_alternative<action_trace>(inner.inner))
            top_traces.push_back(&std::get<action_trace>(inner.inner));
      eosio::check(!(top_traces.size() & 1), "unexpected number of action traces");
      eosio::check(2 * num + 1 < top_traces.size(), "trace not found");
      return *top_traces[2 * num + 1];
   }

   /* sets up a min functional chain with ec signatures 
    */
   inline void boot_minimal(test_chain& t, bool show = false)
   {
      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {
                          Action{
                              .sender   = AccountNumber{"foo"},  // ignored
                              .contract = AccountNumber{"bar"},  // ignored
                              .method   = {},
                              .rawData  = psio::convert_to_frac(GenesisActionData{
                                   .contracts =  // g.a.d--^ is config file for gen
                                  {
                                       {
                                           .contract = system_contract::transaction_sys::contract,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags = system_contract::transaction_sys::contract_flags,
                                           .code  = read_whole_file("transaction_sys.wasm"),
                                      },
                                       {
                                           .contract     = system_contract::account_sys::contract,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags = system_contract::account_sys::contract_flags,
                                           .code  = read_whole_file("account_sys.wasm"),
                                      },
                                       {
                                           .contract     = proxyContractNum,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags        = 0,
                                           .code         = read_whole_file("proxy_sys.wasm"),
                                      },
                                       {
                                           .contract     = system_contract::auth_fake_sys::contract,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags        = 0,
                                           .code         = read_whole_file("auth_fake_sys.wasm"),
                                      },
                                       {
                                           .contract     = system_contract::auth_ec_sys::contract,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags        = 0,
                                           .code         = read_whole_file("auth_ec_sys.wasm"),
                                      },
                                       {
                                           .contract     = system_contract::verify_ec_sys::contract,
                                           .authContract = system_contract::auth_fake_sys::contract,
                                           .flags        = 0,
                                           .code         = read_whole_file("verify_ec_sys.wasm"),
                                      },
                                  },
                              }),
                          },
                      }))) == "");

      transactor<system_contract::account_sys> asys{system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract};

      REQUIRE(                         //
          psibase::show(               //
              true || show,            //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {asys.startup(std::vector<AccountNumber>{
                          system_contract::transaction_sys::contract,
                          system_contract::account_sys::contract,
                          proxyContractNum,
                          system_contract::auth_fake_sys::contract,
                          system_contract::auth_ec_sys::contract,
                          system_contract::verify_ec_sys::contract,
                      })}))) == "");
   }  // boot_minimal()

   inline AccountNumber add_account(test_chain&   t,
                                    AccountNumber acc,
                                    AccountNumber authContract = AccountNumber("auth-fake-sys"),
                                    bool          show         = false)
   {
      transactor<system_contract::account_sys> asys(system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract);

      auto trace = t.push_transaction(  //
          t.make_transaction({asys.newAccount(acc, authContract, true)}));
      REQUIRE(psibase::show(true, trace) == "");
      return acc;
   }  // add_account()

   inline AccountNumber add_account(test_chain&   t,
                                    const char*   acc,
                                    AccountNumber authContract = AccountNumber("auth-fake-sys"),
                                    bool          show         = false)
   {
      return add_account(t, AccountNumber(acc), authContract, show);
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
                  .rawData  = psio::convert_to_frac(system_contract::auth_ec_sys::action{
                      system_contract::auth_ec_sys::create_account{
                           .name       = name,
                           .public_key = public_key,
                      }}),
              }}));
      REQUIRE(psibase::show(show, trace) == "");
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
      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {{tsys.setCode(acc, 0, 0, read_whole_file(filename))}}))) == "");
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
