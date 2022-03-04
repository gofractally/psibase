#pragma once

#include <base_contracts/account.hpp>
#include <base_contracts/transaction.hpp>
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
                                  .contracts = {{
                                                    .contract      = 1,
                                                    .auth_contract = 1,
                                                    .flags         = boot::contract_flags,
                                                    .code = read_whole_file("transaction.wasm"),
                                                },
                                                {
                                                    .contract      = 2,
                                                    .auth_contract = 1,
                                                    .flags         = account::contract_flags,
                                                    .code = read_whole_file("account.wasm"),
                                                }},
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
                              .sender   = boot::contract,
                              .contract = account::contract,
                              .raw_data = eosio::convert_to_bin(account::action{account::startup{
                                  .next_account_num = 3,
                                  .existing_accounts =
                                      {
                                          {1, "transaction.sys"},
                                          {2, "account.sys"},
                                      },
                              }}),
                          },
                      }))) == "");
   }  // boot_minimal()

   inline account_num add_account(test_chain& t,
                                  const char* name,
                                  const char* auth_contract = "transaction.sys",
                                  bool        show          = false)
   {
      auto trace = t.push_transaction(  //
          t.make_transaction(           //
              {{
                  .sender   = boot::contract,
                  .contract = account::contract,
                  .raw_data = eosio::convert_to_bin(account::action{account::create_account{
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
      auto num = add_account(t, name, "transaction.sys", show);
      REQUIRE(                         //
          psibase::show(               //
              show,                    //
              t.push_transaction(      //
                  t.make_transaction(  //
                      {{
                          .sender   = boot::contract,
                          .contract = boot::contract,
                          .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                              .contract   = num,
                              .vm_type    = 0,
                              .vm_version = 0,
                              .code       = read_whole_file(filename),
                          }}),
                      }}))) == "");
      return num;
   }  // add_contract()

}  // namespace psibase
