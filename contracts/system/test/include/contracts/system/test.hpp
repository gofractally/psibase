#pragma once

#include <catch2/catch.hpp>
#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/rpc_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>
#include <psibase/tester.hpp>

namespace psibase
{
   using std::vector;

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
                          {
                              .sender   = {},  // genesis action... these values are ignored
                              .contract = {},  // to prove that they don't matter
                              .method   = {},
                              .raw_data = psio::convert_to_frac(genesis_action_data{
                                  .contracts =  // g.a.d--^ is config file for gen
                                  {
                                      {
                                          .contract = system_contract::transaction_sys::contract,
                                          .auth_contract = system_contract::auth_fake_sys::contract,
                                          .flags = system_contract::transaction_sys::contract_flags,
                                          .code  = read_whole_file("transaction_sys.wasm"),
                                      },
                                      {
                                          .contract      = system_contract::account_sys::contract,
                                          .auth_contract = system_contract::auth_fake_sys::contract,
                                          .flags = system_contract::account_sys::contract_flags,
                                          .code  = read_whole_file("account_sys.wasm"),
                                      },
                                      {
                                          .contract = system_contract::rpc_account_sys::contract,
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
                          },
                      }))) == "");

      std::cout << "sizeof(psibase::acount_num)" << sizeof(psibase::account_num) << "\n";
      struct FRACPACK expected_layout
      {
         uint8_t  type                         = 0;
         uint32_t size                         = 167;
         uint16_t heap                         = 8;
         uint32_t next_account_num             = 100;
         uint32_t existing_accounts_offset     = 4;
         uint32_t existing_accounts_size_bytes = 5 * 4;  /// offset ptrs
                                                         /*
          uint32_t off0;
          uint32_t off1;
          uint32_t off2;
          uint32_t off3;
          uint32_t off4;
          uint16_t an0_heap = 8;
          uint32_t an0_num; 
          uint32_t an0_name_offset = 4;
          uint32_t an0_name_size = sizeof("transaction.sys");
          char     an0_name[sizeof("transaction.sys")] = "transaction.sys";
          */
      };
      /*
      auto vec = psio::convert_to_frac(account_sys::action{account_sys::startup{
           .next_account_num = 100, 
           .existing_accounts =
               {
                   {transaction_sys::contract, "transaction.sys"},
                   {account_sys::contract, "account.sys"},
                   {auth_fake_sys::contract, "auth_fake.sys"},
                   {auth_ec_sys::contract, "auth_ec.sys"},
                   {verify_ec_sys::contract, "verify_ec.sys"},
               },
       }});
      std::cout << "fracpacksize; " << vec.size() <<"\n";
      std::cout << "expected_layoutsize: " << sizeof(expected_layout) <<"\n";
      auto& el = *reinterpret_cast<const expected_layout*>( vec.data() );
      std::cout << "el.type: " << el.type <<"\n";
      std::cout << "el.size: " << el.size<<"\n";
      std::cout << "el.heap: " << el.heap<<"\n";
      std::cout << "el.next_account_num: " << el.next_account_num<<"\n";
      std::cout << "el.existing_accounts_offset: " << el.existing_accounts_offset<<"\n";
      std::cout << "el.existing_accounts_size_bytes: " << el.existing_accounts_size_bytes<<"\n";
      REQUIRE( psio::fracvalidate<account_sys::action>( vec.data(), vec.size() ).valid );

      psio::view<account_sys::startup>  vi( vec.data() + 5 );
      std::cout << "el.existing_accounts.size: " << vi->existing_accounts()->size() <<"\n";
      */

      transactor<system_contract::account_sys> asys{system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract};

      REQUIRE(                         //
          psibase::show(               //
              true || show,            //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {asys.startup(vector<AccountNumber>{
                          {system_contract::transaction_sys::contract},
                          {system_contract::account_sys::contract},
                          {system_contract::rpc_contract_num},
                          {system_contract::auth_fake_sys::contract},
                          {system_contract::auth_ec_sys::contract},
                          {system_contract::verify_ec_sys::contract},
                      })}))) == "");
   }  // boot_minimal()

   inline AccountNumber add_account(test_chain&   t,
                                    AccountNumber acc,
                                    AccountNumber auth_contract = AccountNumber("auth-fake-sys"),
                                    bool          show          = false)
   {
      transactor<system_contract::account_sys> asys(system_contract::transaction_sys::contract,
                                                    system_contract::account_sys::contract);
      auto                                     trace = t.push_transaction(  //
          t.make_transaction({asys.create_account(acc, auth_contract, false)}));

      REQUIRE(psibase::show(show, trace) == "");
      auto& at = get_top_action(trace, 0);
      return psio::convert_from_frac<account_num>(at.raw_retval);
   }  // add_contract()

   inline AccountNumber add_account(test_chain&   t,
                                    const char*   acc,
                                    AccountNumber auth_contract = AccountNumber("auth-fake-sys"),
                                    bool          show          = false)
   {
      return add_account(t, AccountNumber(acc), auth_contract, show);
   }

   inline AccountNumber add_ec_account(test_chain&              t,
                                       AccountNumber            name,
                                       const eosio::public_key& public_key,
                                       bool                     show = false)
   {
      transactor<system_contract::auth_ec_sys> aecsys(system_contract::transaction_sys::contract,
                                                      system_contract::auth_ec_sys::contract);

      auto trace = t.push_transaction(  //
          t.make_transaction(           //
              {{aecsys.setKey(name, public_key)}}));
      REQUIRE(psibase::show(show, trace) == "");
      auto& at = get_top_action(trace, 0);
      return psio::convert_from_frac<AccountNumber>(at.raw_retval);
   }  // add_ec_account()
   inline AccountNumber add_ec_account(test_chain&              t,
                                       const char*              name,
                                       const eosio::public_key& public_key,
                                       bool                     show = false)
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
