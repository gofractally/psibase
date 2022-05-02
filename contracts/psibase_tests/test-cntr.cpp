#include "test-cntr.hpp"

#include <stdio.h>
#include <psibase/block.hpp>
#include <psibase/intrinsic.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_json.hpp>

using namespace psibase;
using namespace test_cntr;

struct startup
{
   startup() { printf("Starting up test-cntr\n"); }
};
startup s;

extern "C" void __wasm_call_ctors();
extern "C" void start(AccountNumber this_contract)
{
   __wasm_call_ctors();
   printf("This is contract %s\n", this_contract.str().c_str());
}

extern "C" void called(AccountNumber this_contract, AccountNumber sender)
{
   // printf("called this_contract=%d, sender=%d\n", this_contract, sender);
   auto act = get_current_action();
   auto pl  = psio::convert_from_frac<payload>(act.rawData);
   printf("payload: %s\n", psio::convert_to_json(pl).c_str());
   if (pl.number)
   {
      auto r = psio::convert_from_frac<int>(call({
          .sender   = this_contract,
          .contract = this_contract,
          .rawData  = psio::convert_to_frac(payload{
               .number = pl.number - 1,
               .memo   = pl.memo,
          }),
      }));
      printf("Child returned %d\n", r);
      printf("Back to %d\n", pl.number);
   }
   set_retval(pl.number);
}
