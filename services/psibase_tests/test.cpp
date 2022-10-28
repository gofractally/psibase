#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include "test-service.hpp"

using namespace psibase;

TEST_CASE("recursion")
{
   DefaultTestChain t;
   t.addService(AccountNumber("test-service"), "test-service.wasm");

   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender  = AccountNumber("test-service"),
                        .service = AccountNumber("test-service"),
                        .rawData = psio::convert_to_frac(test_cntr::payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }})))
           .empty());
}  // recursion

TEST_CASE("kv")
{
   DefaultTestChain t;

   auto test_kv_service = t.addService("test-kv", "test_kv.wasm");
   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender  = test_kv_service,
                        .service = test_kv_service,
                    }})))
           .empty());
}  // kv

TEST_CASE("table")
{
   DefaultTestChain t;

   auto test_table_service = t.addService("test-table", "test_table.wasm");
   REQUIRE(                         //
       show(false,                  //
            t.pushTransaction(      //
                t.makeTransaction(  //
                    {{
                        .sender  = test_table_service,
                        .service = test_table_service,
                    }})))
           .empty());
}  // table
