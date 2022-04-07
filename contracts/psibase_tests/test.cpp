#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include "test-cntr.hpp"

using namespace eosio;
using namespace psibase;

TEST_CASE("recursion")
{
   DefaultTestChain t;
   t.add_contract(AccountNumber("test-cntr"), "test-cntr.wasm");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = AccountNumber("test-cntr"),
                        .contract = AccountNumber("test-cntr"),
                        .raw_data = psio::convert_to_frac(test_cntr::payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }}))) == "");
}  // recursion

TEST_CASE("kv")
{
   DefaultTestChain t;

   auto test_kv_contract = t.add_contract("test_kv", "test_kv.wasm");
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
   /*
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
                    */
}  // table
