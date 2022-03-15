#define CATCH_CONFIG_MAIN
#include <base_contracts/test.hpp>

#include "test-cntr.hpp"
#include "token.hpp"

using namespace eosio;
using namespace psibase;

TEST_CASE("recursion")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   auto test_contract = add_contract(t, "test-cntr", "test-cntr.wasm");
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = test_contract,
                        .contract = test_contract,
                        .raw_data = eosio::convert_to_bin(test_cntr::payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }}))) == "");
}  // recursion

TEST_CASE("transfer")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   check(token::contract == add_contract(t, "token.sys", "token.wasm"),
         "token contract num changed");
   auto alice = add_account(t, "alice");
   auto bob   = add_account(t, "bob");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                         .sender   = token::contract,
                         .contract = token::contract,
                         .raw_data = eosio::convert_to_bin(token::action{token::issue{
                             .to     = alice,
                             .amount = s2a("1.0000 TOK"),
                             .memo   = "issuing",
                         }}),
                     },
                     {
                         .sender   = alice,
                         .contract = token::contract,
                         .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                             .to     = bob,
                             .amount = s2a("0.1000 TOK"),
                             .memo   = "alice->bob",
                         }}),
                     }}))) == "");

   for (int i = 0; i < 100; ++i)
      REQUIRE(                          //
          show(false,                   //
               t.push_transaction(      //
                   t.make_transaction(  //
                       {{
                           .sender   = alice,
                           .contract = token::contract,
                           .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                               .to     = bob,
                               .amount = s2a("0.0001 TOK"),
                               .memo   = "alice->bob",
                           }}),
                       }}))) == "");

}  // transfer

TEST_CASE("kv")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   auto test_kv_contract = add_contract(t, "test_kv", "test_kv.wasm");
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = test_kv_contract,
                        .contract = test_kv_contract,
                    }}))) == "");
}  // kv

TEST_CASE("table")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   auto test_table_contract = add_contract(t, "test_table", "test_table.wasm");
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = test_table_contract,
                        .contract = test_table_contract,
                    }}))) == "");
}  // table
