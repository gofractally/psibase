#include "test-service.hpp"

#include <stdio.h>
#include <psibase/block.hpp>
#include <psibase/RawNativeFunctions.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_json.hpp>

using namespace psibase;
using namespace test_cntr;

struct startup
{
   startup() { printf("Starting up test-service\n"); }
};
startup s;

extern "C" void __wasm_call_ctors();
extern "C" void start(AccountNumber this_service)
{
   __wasm_call_ctors();
   printf("This is service %s\n", this_service.str().c_str());
}

extern "C" void called(AccountNumber this_service, AccountNumber sender)
{
   // printf("called this_service=%d, sender=%d\n", this_service, sender);
   auto act = getCurrentAction();
   auto pl  = psio::from_frac<payload>(act.rawData);
   printf("payload: %s\n", psio::convert_to_json(pl).c_str());
   if (pl.number)
   {
      auto r = psio::from_frac<int>(call({
          .sender  = this_service,
          .service = this_service,
          .rawData = psio::convert_to_frac(payload{
              .number = pl.number - 1,
              .memo   = pl.memo,
          }),
      }));
      printf("Child returned %d\n", r);
      printf("Back to %d\n", pl.number);
   }
   setRetval(pl.number);
}
