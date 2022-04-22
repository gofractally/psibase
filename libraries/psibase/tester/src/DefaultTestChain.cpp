#include <psibase/DefaultTestChain.hpp>

#include <utility>
#include <vector>

// Not sure which of these I need //////
#include <secp256k1.h>
#include <eosio/abi.hpp>
#include <eosio/from_string.hpp>
////////////////////////////////////////

#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>

using namespace psibase;

DefaultTestChain::DefaultTestChain(
    const std::vector<std::pair<AccountNumber, const char*>>& additionalContracts /* = {{}} */,
    const char*                                               snapshot /* = nullptr */,
    uint64_t                                                  state_size /* = 1024 * 1024 * 1024 */)
    : test_chain(snapshot, state_size)
{
   start_block();
   installSystemContracts();
   createSysContractAccounts();

   for (const auto& c : additionalContracts)
   {
      add_contract(c.first, c.second);
   }
}

void DefaultTestChain::installSystemContracts(bool show /* = false */)
{
   auto trace = push_transaction(make_transaction(  //
       {                                            //
        action{
            .sender   = AccountNumber{"foo"},  // ignored
            .contract = AccountNumber{"bar"},  // ignored
            .method   = {},
            .raw_data = psio::convert_to_frac(genesis_action_data{
                .contracts =  // g.a.d--^ is config file for gen
                {
                    {
                        .contract      = system_contract::transaction_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = system_contract::transaction_sys::contract_flags,
                        .code          = read_whole_file("transaction_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::account_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = system_contract::account_sys::contract_flags,
                        .code          = read_whole_file("account_sys.wasm"),
                    },
                    {
                        .contract      = proxyContractNum,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("proxy_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::auth_fake_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_fake_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::auth_ec_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_ec_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::verify_ec_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("verify_ec_sys.wasm"),
                    },
                },
            }),
        }}));

   eosio::check(psibase::show(show, trace) == "", "Failed to install genesis contracts");
}

void DefaultTestChain::createSysContractAccounts(bool show /* = false */)
{
   transactor<system_contract::account_sys> asys{system_contract::transaction_sys::contract,
                                                 system_contract::account_sys::contract};

   auto trace = push_transaction(make_transaction(  //
       {asys.startup(std::vector<AccountNumber>{
           system_contract::transaction_sys::contract,
           system_contract::account_sys::contract,
           proxyContractNum,
           system_contract::auth_fake_sys::contract,
           system_contract::auth_ec_sys::contract,
           system_contract::verify_ec_sys::contract,
       })}));

   eosio::check(psibase::show(show, trace) == "", "Failed to create system contract accounts");
}

AccountNumber DefaultTestChain::add_account(
    AccountNumber acc,
    AccountNumber auth_contract /* = AccountNumber("auth-fake-sys") */,
    bool          show /* = false */)
{
   std::cout << "add_account: ?\n";
   transactor<system_contract::account_sys> asys(system_contract::transaction_sys::contract,
                                                 system_contract::account_sys::contract);

   auto trace = push_transaction(  //
       make_transaction({asys.newAccount(acc, auth_contract, false)}));

   eosio::check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::add_account(
    const char*   acc,
    AccountNumber auth_contract /* = AccountNumber("auth-fake-sys")*/,
    bool          show /* = false */)
{
   std::cout << "add_account: " << acc <<"\n";
   return add_account(AccountNumber(acc), auth_contract, show);
}

AccountNumber DefaultTestChain::add_ec_account(AccountNumber    name,
                                               const PublicKey& public_key,
                                               bool             show /* = false */)
{
   auto trace = push_transaction(  //
       make_transaction(           //
           {{
               .sender   = system_contract::transaction_sys::contract,
               .contract = system_contract::auth_ec_sys::contract,
               .raw_data = psio::convert_to_frac(system_contract::auth_ec_sys::action{
                   system_contract::auth_ec_sys::create_account{
                       .name       = name,
                       .public_key = public_key,
                   }}),
           }}));

   eosio::check(psibase::show(show, trace) == "", "Failed to add ec account");
   auto& at = get_top_action(trace, 0);
   return psio::convert_from_frac<AccountNumber>(at.raw_retval);
}  // add_ec_account()

AccountNumber DefaultTestChain::add_ec_account(const char*      name,
                                               const PublicKey& public_key,
                                               bool             show /* = false */)
{
   std::cout << "add_ec_account: ?\n";
   return add_ec_account(AccountNumber(name), public_key, show);
}

AccountNumber DefaultTestChain::add_contract(AccountNumber acc,
                                             const char*   filename,
                                             bool          show /* = false */)
{
   std::cout << "add_contract_account: '" << acc.str() << "'\n";
   add_account(acc, AccountNumber("auth-fake-sys"), show);
   transactor<system_contract::transaction_sys> tsys{acc,
                                                     system_contract::transaction_sys::contract};

   auto trace =
       push_transaction(make_transaction({{tsys.setCode(acc, 0, 0, read_whole_file(filename))}}));

   eosio::check(psibase::show(show, trace) == "", "Failed to create contract");

   return acc;
}  // add_contract()

AccountNumber DefaultTestChain::add_contract(const char* acc,
                                             const char* filename,
                                             bool        show /* = false */)
{
   std::cout <<"add_contract: '" << acc <<"'\n";
   return add_contract(AccountNumber(acc), filename, show);
}
