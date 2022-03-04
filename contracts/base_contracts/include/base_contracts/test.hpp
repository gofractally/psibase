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
   }  // boot_minimal
}  // namespace psibase
