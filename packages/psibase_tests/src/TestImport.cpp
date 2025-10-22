#include <services/test/TestImport.hpp>

#include <psibase/dispatch.hpp>
#include <services/test/TestExport.hpp>

using namespace psibase;
using namespace TestService;

void TestImport::testPlain()
{
   to<TestExport>().doExport(44, false);
   testImport(true);
   auto value = to<TestExport>().getValue();
   check(value == 45, std::format("{} != 45", value));
}

void TestImport::testRpc()
{
   to<TestExport>().withFlags(CallFlags::runModeRpc).doExport(44, true);
   testImport(false);
}

void TestImport::testCallback()
{
   to<TestExport>().withFlags(CallFlags::runModeCallback).doExport(44, true);
   testImport(false);
}

void TestImport::testImport(bool expectHandles)
{
   auto handles = importHandles();
   if (expectHandles)
   {
      check(handles.size() == 1, std::format("Wrong number of handles: {}", handles.size()));
      auto value = kvGet<int>(handles[0], std::tuple{}).value();
      ++value;
      kvPut(handles[0], std::tuple{}, value);
   }
   else
   {
      check(handles.empty(), "Handles should not be passed across a change in run mode");
   }
}

PSIBASE_DISPATCH(TestImport)
