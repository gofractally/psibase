#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/test/TestExport.hpp>
#include <services/test/TestImport.hpp>
#include <services/test/TestKV.hpp>
#include <services/test/TestServiceEntry.hpp>
#include <services/test/TestTable.hpp>

using namespace psibase;
using namespace TestService;

TEST_CASE("called entry point")
{
   DefaultTestChain t;
   t.addService(TestServiceEntry::service, "TestServiceEntry.wasm");
   CHECK(t.from(TestServiceEntry::service)
             .to<TestServiceEntry>()
             .call(3, "Counting down")
             .returnVal() == 3);

   auto counters = TestServiceEntry{}.open<CallCounterTable>();
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

TEST_CASE("import/export handles")
{
   DefaultTestChain t;

   t.addService(TestExport::service, "TestExport.wasm", TestExport::flags);
   t.addService(TestImport::service, "TestImport.wasm", TestImport::flags);

   auto exp = t.to<TestExport>();
   auto imp = t.to<TestImport>();

   CHECK(exp.testPlain().succeeded());
   CHECK(exp.testRpc().succeeded());
   CHECK(exp.testCallback().succeeded());
   CHECK(imp.testPlain().succeeded());
   CHECK(imp.testRpc().succeeded());
   CHECK(imp.testCallback().succeeded());
}
