#include "nc-test.hpp"

#include "nc-boot.hpp"
#include "nc-token.hpp"

#include <newchain/native_tables.hpp>
#include <newchain/tester.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace eosio;
using namespace newchain;

std::string show(bool include, transaction_trace t)
{
   if (include || t.error)
      std::cout << pretty_trace(trim_raw_data(t)) << "\n";
   if (t.error)
      return *t.error;
   return {};
}

TEST_CASE("t1")
{
   test_chain t;

   std::cout << "\n\n";
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "start genesis\n";
   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "set first code\n";
   REQUIRE(show(false, t.push_transaction(t.make_transaction(  //
                           {{
                               .sender   = 9999,
                               .contract = 9999,
                               .raw_data = eosio::convert_to_bin(genesis_action_data{
                                   .contracts = {{
                                       .contract      = 1,
                                       .auth_contract = 1,
                                       .flags         = account_row::transaction_psi_flags,
                                       .code          = read_whole_file("nc-boot.wasm"),
                                   }},
                               }),
                           }}))) == "");

   REQUIRE(
       show(false, t.push_transaction(t.make_transaction(  //
                       {
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::startup{
                                   .next_account_num = 2,
                               }}),
                           },
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                                   .auth_contract = 1,
                               }}),
                           },
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                   .contract   = 2,
                                   .vm_type    = 0,
                                   .vm_version = 0,
                                   .code       = read_whole_file("nc-test-cntr.wasm"),
                               }}),
                           },
                       }))) == "");

   REQUIRE(show(false, t.push_transaction(t.make_transaction(  //
                           {{
                               .sender   = 2,
                               .contract = 2,
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
   REQUIRE(show(false, t.push_transaction(t.make_transaction(  //
                           {{
                               .sender   = 9999,
                               .contract = 9999,
                               .raw_data = eosio::convert_to_bin(genesis_action_data{
                                   .contracts = {{
                                       .contract      = 1,
                                       .auth_contract = 1,
                                       .flags         = account_row::transaction_psi_flags,
                                       .code          = read_whole_file("nc-boot.wasm"),
                                   }},
                               }),
                           }}))) == "");

   REQUIRE(
       show(false, t.push_transaction(t.make_transaction(  //
                       {
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::startup{
                                   .next_account_num = 2,
                               }}),
                           },
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                                   .auth_contract = boot::contract,
                               }}),
                           },
                           {
                               .sender   = boot::contract,
                               .contract = boot::contract,
                               .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                   .contract   = 2,
                                   .vm_type    = 0,
                                   .vm_version = 0,
                                   .code       = read_whole_file("nc-token.wasm"),
                               }}),
                           },
                       }))) == "");

   // Accounts 3-102
   for (int i = 0; i < 100; ++i)
      REQUIRE(
          show(false, t.push_transaction(t.make_transaction(  //
                          {{
                              .sender   = boot::contract,
                              .contract = boot::contract,
                              .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                                  .auth_contract = 1,
                              }}),
                          }}))) == "");

   REQUIRE(show(false, t.push_transaction(t.make_transaction(  //
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
      REQUIRE(show(false, t.push_transaction(t.make_transaction(  //
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
