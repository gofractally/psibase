#include <stdio.h>
#include <newchain/block.hpp>
#include <newchain/contract.hpp>
#include <newchain/from_bin.hpp>

using namespace newchain;

struct startup
{
   startup() { printf("Starting up nc-test-cntr\n"); }
};
startup s;

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
   printf("This is contract %d\n", this_contract);
}

extern "C" void called(account_num sender, account_num this_contract, action_num act_num)
{
   printf("Entry sender=%d, this_contract=%d, act_num=%d\n", sender, this_contract, act_num);
   auto current = get_current_action();
   if (act_num == auth_action_num)
   {
      check(sender == 0, "can only authenticate top-level actions");
      auto inner = unpack_all<action>(current.raw_data, "extra data after action");
      // TODO: check keys of inner.sender
      printf("Authenticated account %d\n", inner.sender);
      // TODO: forward return value
      call(inner);
   }
   else if (act_num == 999)
   {
      printf("This is 999\n");
      call({
          .sender   = 1,
          .contract = 1,
          .act      = 1000,
      });
   }
   else if (act_num == 1000)
   {
      printf("This is 1000\n");
   }
   else
   {
      check(false, "unknown action");
   }
}
