#include <base_contracts/prove_ec_sys.hpp>

using namespace psibase;

extern "C" void called(account_num this_contract, account_num sender)
{
   abort_message("this contract has no actions");
}

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
}
