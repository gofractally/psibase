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

void TestService::sendOptional8(std::optional<std::uint8_t> opt)
{
   emit().history().optb(opt);
}

void TestService::sendString(const std::string& s)
{
   emit().history().str(s);
}

void TestService::sendAccount(psibase::AccountNumber a)
{
   emit().history().account(a);
}

void TestService::sendTime(psibase::TimePointSec t)
{
   emit().history().time(t);
}

PSIBASE_DISPATCH(TestService)
