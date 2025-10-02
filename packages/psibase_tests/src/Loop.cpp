#include <services/test/Loop.hpp>

#include <psibase/dispatch.hpp>

using namespace TestService;

void Loop::loop()
{
   while (true)
   {
      asm volatile("");
   }
}

PSIBASE_DISPATCH(Loop)
