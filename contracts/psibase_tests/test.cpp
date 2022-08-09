#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include "test-cntr.hpp"

using namespace psibase;

TEST_CASE("recursion")
{
   DefaultTestChain t;
   t.add_contract(AccountNumber("test-cntr"), "test-cntr.wasm");

   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender   = AccountNumber("test-cntr"),
                        .contract = AccountNumber("test-cntr"),
                        .rawData  = psio::convert_to_frac(test_cntr::payload{
                             .number = 3,
                             .memo   = "Counting down",
                        }),
                    }}))) == "");
}  // recursion

TEST_CASE("kv")
{
   DefaultTestChain t;

   auto test_kv_contract = t.add_contract("test-kv", "test_kv.wasm");
   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender   = test_kv_contract,
                        .contract = test_kv_contract,
                    }}))) == "");
}  // kv

TEST_CASE("table")
{
   DefaultTestChain t;

   auto test_table_contract = t.add_contract("test-table", "test_table.wasm");
   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender   = test_table_contract,
                        .contract = test_table_contract,
                    }}))) == "");
}  // table
