#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/test/EntryPoint.hpp>

using namespace psibase;
using namespace TestService;

TEST_CASE("called entry point")
{
   DefaultTestChain t;
   t.addService(EntryPoint::service, "EntryPoint.wasm");
   CHECK(t.from(EntryPoint::service).to<EntryPoint>().call(3, "Counting down").returnVal() == 3);

   auto counters = EntryPoint{}.open<CallCounterTable>();
   auto called   = counters.get(CallCounterRow::called).value_or(CallCounterRow{});
   CHECK(called.count == 4);
   auto start = counters.get(CallCounterRow::start).value_or(CallCounterRow{});
   CHECK(start.count == 1);
}

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
                    }}))) == "");
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
                    }}))) == "");
}  // table
