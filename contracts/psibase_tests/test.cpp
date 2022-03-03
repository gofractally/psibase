#include "account.hpp"
#include "boot.hpp"
#include "test-cntr.hpp"
#include "token.hpp"

#include <psibase/native_tables.hpp>
#include <psibase/tester.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace eosio;
using namespace psibase;

std::string show(bool include, transaction_trace t)
{
   if (include || t.error)
      std::cout << pretty_trace(trim_raw_data(t)) << "\n";
   if (t.error)
      return *t.error;
   return {};
}

void boot_minimal(test_chain& t)
{
   REQUIRE(                          //
       show(false,                   //
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
                                                  .code          = read_whole_file("boot.wasm"),
                                              },
                                              {
                                                  .contract      = 2,
                                                  .auth_contract = 1,
                                                  .flags         = account::contract_flags,
                                                  .code          = read_whole_file("account.wasm"),
                                              }},
                            }),
                        },
                    }))) == "");

   REQUIRE(                          //
       show(false,                   //
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
}  // boot

TEST_CASE("t1")
{
   test_chain t;

   std::cout << "\n\n";
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "start genesis\n";
   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "boot\n";
   boot_minimal(t);

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {
                        {
                            .sender   = boot::contract,
                            .contract = account::contract,
                            .raw_data =
                                eosio::convert_to_bin(account::action{account::create_account{
                                    .name          = "test-cntr",
                                    .auth_contract = "transaction.sys",
                                }}),
                        },
                        {
                            .sender   = boot::contract,
                            .contract = boot::contract,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = 3,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("test-cntr.wasm"),
                            }}),
                        },
                    }))) == "");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = 3,
                        .contract = 3,
                        .raw_data = eosio::convert_to_bin(payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }}))) == "");

   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "\n\n" << t.get_path() << "\n\n";
   execute("ls -lh " + t.get_path());
   std::cout << "\n\n";
}  // t1

TEST_CASE("t2")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {
                        {
                            .sender   = boot::contract,
                            .contract = account::contract,
                            .raw_data =
                                eosio::convert_to_bin(account::action{account::create_account{
                                    .name          = "token.sys",
                                    .auth_contract = "transaction.sys",
                                }}),
                        },
                        {
                            .sender   = boot::contract,
                            .contract = boot::contract,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = token::contract,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("token.wasm"),
                            }}),
                        },
                    }))) == "");

   // Accounts 4-103
   for (int i = 0; i < 100; ++i)
      REQUIRE(                          //
          show(false,                   //
               t.push_transaction(      //
                   t.make_transaction(  //
                       {
                           {
                               .sender   = boot::contract,
                               .contract = account::contract,
                               .raw_data =
                                   eosio::convert_to_bin(account::action{account::create_account{
                                       .name          = "x" + std::to_string(i),
                                       .auth_contract = "transaction.sys",
                                   }}),
                           },
                       }))) == "");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                         .sender   = token::contract,
                         .contract = token::contract,
                         .raw_data = eosio::convert_to_bin(token::action{token::issue{
                             .to     = 3,
                             .amount = s2a("1.0000 TOK"),
                             .memo   = "issuing",
                         }}),
                     },
                     {
                         .sender   = 3,
                         .contract = token::contract,
                         .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                             .to     = 4,
                             .amount = s2a("0.1000 TOK"),
                             .memo   = "3->4",
                         }}),
                     }}))) == "");

   for (int i = 0; i < 100; ++i)
      REQUIRE(                          //
          show(false,                   //
               t.push_transaction(      //
                   t.make_transaction(  //
                       {{
                           .sender   = 3,
                           .contract = token::contract,
                           .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                               .to     = 4,
                               .amount = s2a("0.0001 TOK"),
                               .memo   = "3->4",
                           }}),
                       }}))) == "");

}  // t2
