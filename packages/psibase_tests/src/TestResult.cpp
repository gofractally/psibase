#include <services/test/TestResult.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

std::string TestResult::symbol(std::uint32_t token)
{
   return testSymbol(token);
}
std::vector<std::string> TestResult::names(std::uint32_t count)
{
   return testNames(count);
}
std::string TestResult::relay(AccountNumber callee, std::uint32_t token)
{
   return Actor<TestResult>{service, callee}.symbol(token);
}
std::string TestResult::relayView(AccountNumber callee, std::uint32_t token)
{
   return Actor<TestResult>{service, callee}.view().symbol(token).unpack();
}
std::vector<std::string> TestResult::relayNames(AccountNumber callee, std::uint32_t count)
{
   return Actor<TestResult>{service, callee}.names(count);
}
std::vector<std::string> TestResult::relayNamesView(AccountNumber callee, std::uint32_t count)
{
   // The view of the packed result reads the one-byte offset table that
   // returns(...) gives the list.
   auto                     packed = Actor<TestResult>{service, callee}.view().names(count);
   std::vector<std::string> result;
   for (auto name : packed.view())
      result.push_back(std::string{std::string_view{name}});
   return result;
}

PSIBASE_DISPATCH(TestResult)
