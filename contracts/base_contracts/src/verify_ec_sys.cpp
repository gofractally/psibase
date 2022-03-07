#include <base_contracts/verify_ec_sys.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/from_bin.hpp>

using namespace psibase;

extern "C" [[clang::export_name("verify")]] void verify()
{
   auto act     = get_current_action();
   auto data    = eosio::convert_from_bin<verify_data>(act.raw_data);
   auto pub_key = unpack_all<eosio::public_key>(data.claim.raw_data, "extra data in claim");
   auto sig     = unpack_all<eosio::signature>(data.proof, "extra data in proof");
   // TODO: verify
}

extern "C" void called(account_num this_contract, account_num sender)
{
   abort_message("this contract has no actions");
}

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
}
