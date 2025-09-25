#include <services/test/TestExport.hpp>

#include <psibase/dispatch.hpp>
#include <services/test/TestImport.hpp>

using namespace psibase;
using namespace TestService;

void TestExport::testPlain()
{
   doExport(42, false);
   to<TestImport>().testImport(true);
   auto value = getValue();
   check(value == 43, std::format("{} != 43", value));
}

void TestExport::testRpc()
{
   doExport(42, false);
   to<TestImport>().withFlags(CallFlags::runModeRpc).testImport(false);
}

void TestExport::testCallback()
{
   doExport(42, false);
   to<TestImport>().withFlags(CallFlags::runModeCallback).testImport(false);
}

void TestExport::doExport(int initialValue, bool subjective)
{
   auto handle = kvOpen(subjective ? DbId::subjective : DbId::service,
                        psio::convert_to_key(getReceiver()), KvMode::readWrite);
   if (subjective)
      PSIBASE_SUBJECTIVE_TX
      {
         kvPut(handle, std::tuple{}, initialValue);
      }
   else
      kvPut(handle, std::tuple{}, initialValue);

   exportHandles(std::span{&handle, 1});
   kvClose(handle);
}

int TestExport::getValue()
{
   auto handle = kvOpen(DbId::service, psio::convert_to_key(getReceiver()), KvMode::readWrite);
   auto row    = kvGet<int>(handle, std::tuple{});
   kvClose(handle);
   check(row.has_value(), "Missing value");
   return *row;
}

PSIBASE_DISPATCH(TestExport)
