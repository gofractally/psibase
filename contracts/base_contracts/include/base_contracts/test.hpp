#pragma once

#include <base_contracts/account_sys.hpp>
#include <base_contracts/auth_ec_sys.hpp>
#include <base_contracts/auth_fake_sys.hpp>
#include <base_contracts/transaction_sys.hpp>
#include <catch2/catch.hpp>
#include <psibase/native_tables.hpp>
#include <psibase/tester.hpp>

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
      eosio::check(t.action_traces.size() == 1, "unexpected transaction_trace layout");
      auto&                            root = t.action_traces[0];
      std::vector<const action_trace*> top_traces;
      for (auto& inner : root.inner_traces)
         if (std::holds_alternative<action_trace>(inner.inner))
            top_traces.push_back(&std::get<action_trace>(inner.inner));
      eosio::check(!(top_traces.size() & 1), "unexpected number of action traces");
      eosio::check(2 * num + 1 < top_traces.size(), "trace not found");
      return *top_traces[2 * num + 1];
   }

   inline void boot_minimal(test_chain& t, bool show = false)
   {
      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {
                          {
                              .sender   = 9999,
                              .contract = 9999,
                              .raw_data = eosio::convert_to_bin(genesis_action_data{
                                  .contracts =
                                      {
                                          {
                                              .contract      = transaction_sys::contract,
                                              .auth_contract = auth_fake_sys::contract,
                                              .flags         = transaction_sys::contract_flags,
                                              .code = read_whole_file("transaction_sys.wasm"),
                                          },
                                          {
                                              .contract      = account_sys::contract,
                                              .auth_contract = auth_fake_sys::contract,
                                              .flags         = account_sys::contract_flags,
                                              .code          = read_whole_file("account_sys.wasm"),
                                          },
                                          {
                                              .contract      = auth_fake_sys::contract,
                                              .auth_contract = auth_fake_sys::contract,
                                              .flags         = 0,
                                              .code = read_whole_file("auth_fake_sys.wasm"),
                                          },
                                          {
                                              .contract      = auth_ec_sys::contract,
                                              .auth_contract = auth_fake_sys::contract,
                                              .flags         = 0,
                                              .code          = read_whole_file("auth_ec_sys.wasm"),
                                          },
                                      },
                              }),
                          },
                      }))) == "");

      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {
                          {
                              .sender   = transaction_sys::contract,
                              .contract = account_sys::contract,
                              .raw_data =
                                  eosio::convert_to_bin(account_sys::action{account_sys::startup{
                                      .next_account_num = 100,
                                      .existing_accounts =
                                          {
                                              {transaction_sys::contract, "transaction.sys"},
                                              {account_sys::contract, "account.sys"},
                                              {auth_fake_sys::contract, "auth_fake_sys.sys"},
                                              {auth_ec_sys::contract, "auth_ec_sys.sys"},
                                          },
                                  }}),
                          },
                      }))) == "");
   }  // boot_minimal()

   inline account_num add_account(test_chain& t,
                                  const char* name,
                                  const char* auth_contract = "auth_fake_sys.sys",
                                  bool        show          = false)
   {
      auto trace = t.push_transaction(  //
          t.make_transaction(           //
              {{
                  .sender   = transaction_sys::contract,
                  .contract = account_sys::contract,
                  .raw_data = eosio::convert_to_bin(account_sys::action{account_sys::create_account{
                      .name          = name,
                      .auth_contract = auth_contract,
                  }}),
              }}));
      REQUIRE(psibase::show(show, trace) == "");
      auto& at = get_top_action(trace, 0);
      return eosio::convert_from_bin<account_num>(at.raw_retval);
   }  // add_contract()

   inline account_num add_contract(test_chain& t,
                                   const char* name,
                                   const char* filename,
                                   bool        show = false)
   {
      auto num = add_account(t, name, "auth_fake_sys.sys", show);
      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {{
                          .sender   = num,
                          .contract = transaction_sys::contract,
                          .raw_data = eosio::convert_to_bin(
                              transaction_sys::action{transaction_sys::set_code{
                                  .contract   = num,
                                  .vm_type    = 0,
                                  .vm_version = 0,
                                  .code       = read_whole_file(filename),
                              }}),
                      }}))) == "");
      return num;
   }  // add_contract()

}  // namespace psibase
