#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/test/EntryPoint.hpp>
#include <services/test/TestKV.hpp>
#include <services/test/TestTable.hpp>

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

   t.addService(TestKV::service, "TestKV.wasm");
   CHECK(t.from(TestKV::service).to<TestKV>().test().succeeded());
}  // kv

TEST_CASE("table")
{
   DefaultTestChain t;

   t.addService(TestTable::service, "TestTable.wasm");
   auto testTable = t.from(TestTable::service).to<TestTable>();
   CHECK(testTable.getSingle().succeeded());
   CHECK(testTable.getMulti().succeeded());
   CHECK(testTable.getCompound().succeeded());
   CHECK(testTable.removeSingle().succeeded());
   CHECK(testTable.removeMulti().succeeded());
   CHECK(testTable.subindex().succeeded());
}  // table
