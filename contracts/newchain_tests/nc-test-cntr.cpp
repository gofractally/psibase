#include <newchain/contract.hpp>

#include <stdio.h>
#include <newchain/block.hpp>

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
   if (act_num == auth_action_num)
   {
      check(sender == 0, "can only authenticate top-level actions");
      // TODO
   }
}
