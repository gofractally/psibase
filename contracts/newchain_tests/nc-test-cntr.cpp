#include "nc-test.hpp"

#include <stdio.h>
#include <newchain/block.hpp>
#include <newchain/from_bin.hpp>
#include <newchain/intrinsic.hpp>

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

extern "C" [[clang::export_name("auth")]] void auth(account_num this_contract)
{
   printf("auth this_contract=%d\n", this_contract);

   // TODO: only unpack the needed fields
   auto act = get_current_action();
   printf("act:%s\n", eosio::convert_to_json(act).c_str());
   // TODO: check keys of act.sender
   printf("Authenticated account %d\n", act.sender);
   // TODO: forward return value
   call(act);
}

extern "C" void called(account_num this_contract, account_num sender)
{
   // printf("called this_contract=%d, sender=%d\n", this_contract, sender);
   auto act = get_current_action();
   auto pl  = eosio::convert_from_bin<payload>(act.raw_data);
   printf("%s\n", eosio::convert_to_json(pl).c_str());
   if (pl.number)
      call({
          .sender   = this_contract,
          .contract = this_contract,
          .raw_data = eosio::convert_to_bin(payload{
              .number = pl.number - 1,
              .memo   = pl.memo,
          }),
      });
   printf("Back to %d\n", pl.number);
}
