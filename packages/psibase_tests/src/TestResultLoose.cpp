#include <services/test/TestResult.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

std::string TestResultLoose::symbol(std::uint32_t token)
{
   return testSymbol(token);
}
std::vector<std::string> TestResultLoose::names(std::uint32_t count)
{
   return testNames(count);
}

PSIBASE_DISPATCH(TestResultLoose)
