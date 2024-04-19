#include "TestService.hpp"

#include <psibase/dispatch.hpp>

void TestService::send(int i, double d, std::vector<int32_t> v, std::string s)
{
   emit().history().testEvent(i, d, v, s);
}

void TestService::sendOptional(std::optional<std::int32_t> opt)
{
   emit().history().opt(opt);
}

PSIBASE_DISPATCH(TestService)
