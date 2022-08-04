#include <psibase/DefaultTestChain.hpp>

#include <contracts/system/AccountSys.hpp>
#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/AuthFakeSys.hpp>
#include <contracts/system/CommonSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <contracts/system/RAccountSys.hpp>
#include <contracts/system/RAuthEcSys.hpp>
#include <contracts/system/RProxySys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <contracts/system/VerifyEcSys.hpp>
#include <contracts/user/ExploreSys.hpp>
#include <psibase/contractEntry.hpp>
#include <utility>
#include <vector>

using namespace psibase;
using namespace system_contract;

DefaultTestChain::DefaultTestChain(
    const std::vector<std::pair<AccountNumber, const char*>>& additionalContracts /* = {{}} */,
    const char*                                               snapshot /* = nullptr */,
    uint64_t                                                  state_size /* = 1024 * 1024 * 1024 */)
    : test_chain(snapshot, state_size)
{
   start_block();
   deploySystemContracts();
   start_block();
   createSysContractAccounts();
   registerSysRpc();

   for (const auto& c : additionalContracts)
   {
      add_contract(c.first, c.second);
   }
}

void DefaultTestChain::deploySystemContracts(bool show /* = false */)
{
   auto trace = pushTransaction(  //
       make_transaction(          //
           {                      //
            Action{
                .sender   = AccountNumber{"foo"},  // ignored
                .contract = AccountNumber{"bar"},  // ignored
                .method   = {},
                .rawData  = psio::convert_to_frac(GenesisActionData{
                     .contracts =  // g.a.d--^ is config file for gen
                    {
                         {
                             .contract     = system_contract::TransactionSys::contract,
                             .authContract = system_contract::AuthFakeSys::contract,
                             .flags        = system_contract::TransactionSys::contractFlags,
                             .code         = read_whole_file("TransactionSys.wasm"),
                        },
                         {
                             .contract     = system_contract::AccountSys::contract,
                             .authContract = system_contract::AuthFakeSys::contract,
                             .flags        = system_contract::AccountSys::contractFlags,
                             .code         = read_whole_file("AccountSys.wasm"),
                        },
                         {
                             .contract     = ProxySys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("ProxySys.wasm"),
                        },
                         {
                             .contract     = system_contract::AuthFakeSys::contract,
                             .authContract = system_contract::AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("AuthFakeSys.wasm"),
                        },
                         {
                             .contract     = system_contract::AuthEcSys::contract,
                             .authContract = system_contract::AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("AuthEcSys.wasm"),
                        },
                         {
                             .contract     = system_contract::VerifyEcSys::contract,
                             .authContract = system_contract::AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("VerifyEcSys.wasm"),
                        },
                         {
                             .contract     = CommonSys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("CommonSys.wasm"),
                        },
                         {
                             .contract     = RAccountSys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("RAccountSys.wasm"),
                        },
                         {
                             .contract     = ExploreSys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("ExploreSys.wasm"),
                        },
                         {
                             .contract     = RAuthEcSys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("RAuthEcSys.wasm"),
                        },
                         {
                             .contract     = RProxySys::contract,
                             .authContract = AuthFakeSys::contract,
                             .flags        = 0,
                             .code         = read_whole_file("RProxySys.wasm"),
                        },
                    },
                }),
            }}),
       {});

   check(psibase::show(show, trace) == "", "Failed to deploy genesis contracts");
}

void DefaultTestChain::createSysContractAccounts(bool show /* = false */)
{
   transactor<system_contract::AccountSys> asys{system_contract::TransactionSys::contract,
                                                system_contract::AccountSys::contract};
   auto trace = pushTransaction(make_transaction({asys.startup()}));

   check(psibase::show(show, trace) == "", "Failed to create system contract accounts");
}

AccountNumber DefaultTestChain::add_account(
    AccountNumber acc,
    AccountNumber authContract /* = AccountNumber("auth-fake-sys") */,
    bool          show /* = false */)
{
   transactor<system_contract::AccountSys> asys(system_contract::TransactionSys::contract,
                                                system_contract::AccountSys::contract);

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
   transactor<system_contract::AccountSys> asys(system_contract::AccountSys::contract,
                                                system_contract::AccountSys::contract);
   transactor<system_contract::AuthEcSys>  ecsys(system_contract::AuthEcSys::contract,
                                                 system_contract::AuthEcSys::contract);

   auto trace = pushTransaction(make_transaction({
       asys.newAccount(name, "auth-fake-sys", true),
       ecsys.as(name).setKey(public_key),
       asys.as(name).setAuthCntr(system_contract::AuthEcSys::contract),
   }));

   check(psibase::show(show, trace) == "", "Failed to add ec account");
   return name;
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

   transactor<system_contract::TransactionSys> tsys{acc, system_contract::TransactionSys::contract};

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
   auto r = ProxySys::contract;

   // Register servers
   std::vector<psibase::Action> a{
       transactor<ProxySys>{CommonSys::contract, r}.registerServer(CommonSys::contract),
       transactor<ProxySys>{AccountSys::contract, r}.registerServer(RAccountSys::contract),
       transactor<ProxySys>{ExploreSys::contract, r}.registerServer(ExploreSys::contract),
       transactor<ProxySys>{AuthEcSys::contract, r}.registerServer(RAuthEcSys::contract),
       transactor<ProxySys>{ProxySys::contract, r}.registerServer(RProxySys::contract)};

   auto trace = pushTransaction(make_transaction(std::move(a)));
   check(psibase::show(false, trace) == "", "Failed to register system rpc contracts");

   transactor<CommonSys>   rpcCommon(CommonSys::contract, CommonSys::contract);
   transactor<RAccountSys> rpcAccount(RAccountSys::contract, RAccountSys::contract);
   transactor<ExploreSys>  rpcExplore(ExploreSys::contract, ExploreSys::contract);
   transactor<RAuthEcSys>  rpcAuthEc(RAuthEcSys::contract, RAuthEcSys::contract);

   // Store UI files
   std::string cdir      = "../contracts";
   std::string comDir    = cdir + "/user/CommonSys";
   std::string accDir    = cdir + "/system/AccountSys";
   std::string expDir    = cdir + "/user/ExploreSys";
   std::string authEcDir = cdir + "/system/AuthEcSys";
   std::string thirdPty  = comDir + "/common/thirdParty/src";

   const std::string html = "text/html";
   const std::string js   = "text/javascript";

   std::vector<psibase::Action> b{
       // CommonSys
       rpcCommon.storeSys("/", html, read_whole_file(comDir + "/ui/index.html")),
       rpcCommon.storeSys("/ui/common.index.html", html,
                          read_whole_file(comDir + "/ui/common.index.html")),

       rpcCommon.storeSys("/common/rpc.mjs", js, read_whole_file(comDir + "/common/rpc.mjs")),
       rpcCommon.storeSys("/common/useGraphQLQuery.mjs", js,
                          read_whole_file(comDir + "/common/useGraphQLQuery.mjs")),
       rpcCommon.storeSys("/common/SimpleUI.mjs", js,
                          read_whole_file(comDir + "/common/SimpleUI.mjs")),
       rpcCommon.storeSys("/common/keyConversions.mjs", js,
                          read_whole_file(comDir + "/common/keyConversions.mjs")),
       rpcCommon.storeSys("/common/widgets.mjs", js,
                          read_whole_file(comDir + "/common/widgets.mjs")),
       rpcCommon.storeSys("/ui/index.js", js, read_whole_file(comDir + "/ui/index.js")),

       // CommonSys - 3rd party
       rpcCommon.storeSys("/common/iframeResizer.js", js,
                          read_whole_file(thirdPty + "/iframeResizer.js")),
       rpcCommon.storeSys("/common/iframeResizer.contentWindow.js", js,
                          read_whole_file(thirdPty + "/iframeResizer.contentWindow.js")),
       rpcCommon.storeSys("/common/react.production.min.js", js,
                          read_whole_file(thirdPty + "/react.production.min.js")),
       rpcCommon.storeSys("/common/react-dom.production.min.js", js,
                          read_whole_file(thirdPty + "/react-dom.production.min.js")),
       rpcCommon.storeSys("/common/react-router-dom.min.js", js,
                          read_whole_file(thirdPty + "/react-router-dom.min.js")),
       rpcCommon.storeSys("/common/htm.module.js", js,
                          read_whole_file(thirdPty + "/htm.module.js")),
       rpcCommon.storeSys("/common/react.development.js", js,
                          read_whole_file(thirdPty + "/react.development.js")),
       rpcCommon.storeSys("/common/react-dom.development.js", js,
                          read_whole_file(thirdPty + "/react-dom.development.js")),
       rpcCommon.storeSys("/common/semantic-ui-react.min.js", js,
                          read_whole_file(thirdPty + "/semantic-ui-react.min.js")),
       rpcCommon.storeSys("/common/use-local-storage-state.mjs", js,
                          read_whole_file(thirdPty + "/useLocalStorageState.js")),

       // AccountSys
       rpcAccount.storeSys("/", html, read_whole_file(accDir + "/ui/index.html")),
       rpcAccount.storeSys("/ui/index.js", js, read_whole_file(accDir + "/ui/index.js")),

       // AuthEcSys
       rpcAuthEc.storeSys("/", html, read_whole_file(authEcDir + "/ui/index.html")),
       rpcAuthEc.storeSys("/ui/index.js", js, read_whole_file(authEcDir + "/ui/index.js")),

       // ExploreSys
       rpcExplore.storeSys("/ui/index.js", js, read_whole_file(expDir + "/ui/index.js"))};

   trace = pushTransaction(make_transaction(std::move(b)));
   check(psibase::show(false, trace) == "", "Failed to add UI files to system rpc contracts");
}