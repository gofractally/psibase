#include <psibase/DefaultTestChain.hpp>

#include <utility>
#include <vector>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/common_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <contracts/user/explore_sys.hpp>

using namespace psibase;
using namespace system_contract;

DefaultTestChain::DefaultTestChain(
    const std::vector<std::pair<AccountNumber, const char*>>& additionalContracts /* = {{}} */,
    const char*                                               snapshot /* = nullptr */,
    uint64_t                                                  state_size /* = 1024 * 1024 * 1024 */)
    : test_chain(snapshot, state_size)
{
   start_block();
   installSystemContracts();
   createSysContractAccounts();
   registerSysRpc();

   for (const auto& c : additionalContracts)
   {
      add_contract(c.first, c.second);
   }
}

void DefaultTestChain::installSystemContracts(bool show /* = false */)
{
   auto trace = pushTransaction(make_transaction(  //
       {                                           //
        Action{
            .sender   = AccountNumber{"foo"},  // ignored
            .contract = AccountNumber{"bar"},  // ignored
            .method   = {},
            .rawData  = psio::convert_to_frac(GenesisActionData{
                 .contracts =  // g.a.d--^ is config file for gen
                {
                     {
                         .contract     = transaction_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = transaction_sys::contractFlags,
                         .code         = read_whole_file("transaction_sys.wasm"),
                    },
                     {
                         .contract     = account_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = account_sys::contractFlags,
                         .code         = read_whole_file("account_sys.wasm"),
                    },
                     {
                         .contract     = proxy_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("proxy_sys.wasm"),
                    },
                     {
                         .contract     = auth_fake_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("auth_fake_sys.wasm"),
                    },
                     {
                         .contract     = auth_ec_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("auth_ec_sys.wasm"),
                    },
                     {
                         .contract     = verify_ec_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("verify_ec_sys.wasm"),
                    },
                     {
                         .contract     = common_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("common_sys.wasm"),
                    },
                     {
                         .contract     = "account-rpc"_a,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("rpc_account_sys.wasm"),
                    },
                     {
                         .contract     = explore_sys::contract,
                         .authContract = auth_fake_sys::contract,
                         .flags        = 0,
                         .code         = read_whole_file("explore_sys.wasm"),
                    },
                },
            }),
        }}));

   check(psibase::show(show, trace) == "", "Failed to install genesis contracts");
}

void DefaultTestChain::createSysContractAccounts(bool show /* = false */)
{
   transactor<account_sys> asys{transaction_sys::contract, account_sys::contract};

   auto trace = pushTransaction(make_transaction(  //
       {asys.startup(std::vector<AccountNumber>{
           transaction_sys::contract,
           account_sys::contract,
           proxy_sys::contract,
           auth_fake_sys::contract,
           auth_ec_sys::contract,
           verify_ec_sys::contract,
       })}));

   check(psibase::show(show, trace) == "", "Failed to create system contract accounts");
}

AccountNumber DefaultTestChain::add_account(
    AccountNumber acc,
    AccountNumber authContract /* = AccountNumber("auth-fake-sys") */,
    bool          show /* = false */)
{
   transactor<account_sys> asys(transaction_sys::contract, account_sys::contract);

   auto trace = pushTransaction(  //
       make_transaction({asys.newAccount(acc, authContract, true)}));

   check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::add_account(
    const char*   acc,
    AccountNumber authContract /* = AccountNumber("auth-fake-sys")*/,
    bool          show /* = false */)
{
   return add_account(AccountNumber(acc), authContract, show);
}

AccountNumber DefaultTestChain::add_ec_account(AccountNumber    name,
                                               const PublicKey& public_key,
                                               bool             show /* = false */)
{
   auto trace = pushTransaction(  //
       make_transaction(          //
           {{
               .sender   = transaction_sys::contract,
               .contract = auth_ec_sys::contract,
               .rawData  = psio::convert_to_frac(auth_ec_sys::action{auth_ec_sys::create_account{
                    .name       = name,
                    .public_key = public_key,
               }}),
           }}));

   check(psibase::show(show, trace) == "", "Failed to add ec account");
   auto& at = get_top_action(trace, 0);
   return psio::convert_from_frac<AccountNumber>(at.rawRetval);
}  // add_ec_account()

AccountNumber DefaultTestChain::add_ec_account(const char*      name,
                                               const PublicKey& public_key,
                                               bool             show /* = false */)
{
   return add_ec_account(AccountNumber(name), public_key, show);
}

AccountNumber DefaultTestChain::add_contract(AccountNumber acc,
                                             const char*   filename,
                                             bool          show /* = false */)
{
   add_account(acc, AccountNumber("auth-fake-sys"), show);
   transactor<transaction_sys> tsys{acc, transaction_sys::contract};

   auto trace =
       pushTransaction(make_transaction({{tsys.setCode(acc, 0, 0, read_whole_file(filename))}}));

   check(psibase::show(show, trace) == "", "Failed to create contract");

   return acc;
}  // add_contract()

AccountNumber DefaultTestChain::add_contract(const char* acc,
                                             const char* filename,
                                             bool        show /* = false */)
{
   return add_contract(AccountNumber(acc), filename, show);
}

void DefaultTestChain::registerSysRpc()
{
   std::string html = "text/html";
   std::string js   = "text/javascript";

   auto                  sender = transaction_sys::contract;
   transactor<proxy_sys> proxySys(sender, proxy_sys::contract);

   std::vector<psibase::Action> a;
   a.push_back(transactor<proxy_sys>{common_sys::contract, proxy_sys::contract}.registerServer(
       common_sys::contract, common_sys::contract));
   a.push_back(transactor<proxy_sys>{account_sys::contract, proxy_sys::contract}.registerServer(
       account_sys::contract, "account-rpc"_a));
   a.push_back(transactor<proxy_sys>{explore_sys::contract, proxy_sys::contract}.registerServer(
       explore_sys::contract, explore_sys::contract));
   auto trace = pushTransaction(make_transaction(std::move(a)));
   check(psibase::show(false, trace) == "", "Failed to register system rpc contracts");

   transactor<common_sys>      rpcCommonSys(common_sys::contract, common_sys::contract);
   transactor<rpc_account_sys> rpcAccountSys("account-rpc"_a, "account-rpc"_a);
   transactor<explore_sys>     rpcExploreSys(explore_sys::contract, explore_sys::contract);

   // common-sys
   std::vector<psibase::Action> b;
   std::string                  cdir = "../contracts/";
   b.push_back(
       rpcCommonSys.storeSys("/", html, read_whole_file(cdir + "user/common_sys/ui/index.html")));
   b.push_back(rpcCommonSys.storeSys("/common/rpc.mjs", js,
                                     read_whole_file(cdir + "user/common_sys/common/rpc.mjs")));
   b.push_back(
       rpcCommonSys.storeSys("/common/useGraphQLQuery.mjs", js,
                             read_whole_file(cdir + "user/common_sys/common/useGraphQLQuery.mjs")));
   b.push_back(rpcCommonSys.storeSys(
       "/common/SimpleUI.mjs", js, read_whole_file(cdir + "user/common_sys/common/SimpleUI.mjs")));
   b.push_back(rpcCommonSys.storeSys("/ui/index.js", js,
                                     read_whole_file(cdir + "user/common_sys/ui/index.js")));

   // account-sys
   b.push_back(rpcAccountSys.storeSys(
       "/", html, read_whole_file(cdir + "system/rpc_account_sys/ui/index.html")));
   b.push_back(rpcAccountSys.storeSys(
       "/ui/index.js", js, read_whole_file(cdir + "system/rpc_account_sys/ui/index.js")));

   // explore-sys
   b.push_back(
       rpcExploreSys.storeSys("/", html, read_whole_file(cdir + "user/explore_sys/ui/index.html")));
   b.push_back(rpcExploreSys.storeSys("/ui/index.js", js,
                                      read_whole_file(cdir + "user/explore_sys/ui/index.js")));

   trace = pushTransaction(make_transaction(std::move(b)));
   check(psibase::show(false, trace) == "", "Failed to add UI files to system rpc contracts");
}