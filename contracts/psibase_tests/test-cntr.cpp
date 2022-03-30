#include "test-cntr.hpp"

#include <stdio.h>
#include <psibase/block.hpp>
#include <psibase/from_bin.hpp>
#include <psibase/intrinsic.hpp>

using namespace psibase;
using namespace test_cntr;

struct startup
{
   startup() { printf("Starting up test-cntr\n"); }
};
startup s;

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
   printf("This is contract %s\n", this_contract.str().c_str());
}

extern "C" void called(account_num this_contract, account_num sender)
{
   // printf("called this_contract=%d, sender=%d\n", this_contract, sender);
   auto act = get_current_action();
   auto pl  = eosio::convert_from_bin<payload>(act.raw_data);
   printf("payload: %s\n", eosio::convert_to_json(pl).c_str());
   if (pl.number)
   {
      auto r = eosio::convert_from_bin<int>(call({
          .sender   = this_contract,
          .contract = this_contract,
          .raw_data = eosio::convert_to_bin(payload{
              .number = pl.number - 1,
              .memo   = pl.memo,
          }),
      }));
      printf("Child returned %d\n", r);
      printf("Back to %d\n", pl.number);
   }
   set_retval(pl.number);
}
