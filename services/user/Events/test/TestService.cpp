#include "TestService.hpp"

#include <psibase/dispatch.hpp>

void TestService::send(int i, double d, std::vector<int32_t> v, std::string s)
{
   emit().history().testEvent(i, d, v, s);
}

PSIBASE_DISPATCH(TestService)
