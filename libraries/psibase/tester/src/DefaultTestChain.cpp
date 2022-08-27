#include <psibase/DefaultTestChain.hpp>

#include <contracts/system/AccountSys.hpp>
#include <contracts/system/AuthAnySys.hpp>
#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/CommonSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <contracts/system/RAccountSys.hpp>
#include <contracts/system/RAuthEcSys.hpp>
#include <contracts/system/RProxySys.hpp>
#include <contracts/system/SetCodeSys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <contracts/system/VerifyEcSys.hpp>
#include <contracts/user/ExploreSys.hpp>
#include <contracts/user/PsiSpaceSys.hpp>
#include <psibase/contractEntry.hpp>
#include <utility>
#include <vector>

using namespace psibase;
using namespace system_contract;

DefaultTestChain::DefaultTestChain(
    const std::vector<std::pair<AccountNumber, const char*>>& additionalContracts,
    uint64_t                                                  max_objects,
    uint64_t                                                  hot_addr_bits,
    uint64_t                                                  warm_addr_bits,
    uint64_t                                                  cool_addr_bits,
    uint64_t                                                  cold_addr_bits)
    : TestChain{max_objects, hot_addr_bits, warm_addr_bits, cool_addr_bits, cold_addr_bits}
{
   startBlock();
   deploySystemContracts();
   startBlock();
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
       makeTransaction(           //
           {                      //
            Action{
                .sender   = AccountNumber{"foo"},  // ignored
                .contract = AccountNumber{"bar"},  // ignored
                .method   = {},
                .rawData  = psio::convert_to_frac(GenesisActionData{
                     .contracts =  // g.a.d--^ is config file for gen
                    {
                         {
                             .contract = system_contract::TransactionSys::contract,
                             .flags    = system_contract::TransactionSys::contractFlags,
                             .code     = readWholeFile("TransactionSys.wasm"),
                        },
                         {
                             .contract = system_contract::SetCodeSys::contract,
                             .flags    = system_contract::SetCodeSys::contractFlags,
                             .code     = readWholeFile("SetCodeSys.wasm"),
                        },
                         {
                             .contract = system_contract::AccountSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("AccountSys.wasm"),
                        },
                         {
                             .contract = ProxySys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("ProxySys.wasm"),
                        },
                         {
                             .contract = system_contract::AuthAnySys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("AuthAnySys.wasm"),
                        },
                         {
                             .contract = system_contract::AuthEcSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("AuthEcSys.wasm"),
                        },
                         {
                             .contract = system_contract::VerifyEcSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("VerifyEcSys.wasm"),
                        },
                         {
                             .contract = CommonSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("CommonSys.wasm"),
                        },
                         {
                             .contract = RAccountSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("RAccountSys.wasm"),
                        },
                         {
                             .contract = ExploreSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("ExploreSys.wasm"),
                        },
                         {
                             .contract = RAuthEcSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("RAuthEcSys.wasm"),
                        },
                         {
                             .contract = RProxySys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("RProxySys.wasm"),
                        },
                         {
                             .contract = PsiSpaceSys::contract,
                             .flags    = 0,
                             .code     = readWholeFile("PsiSpaceSys.wasm"),
                        },
                    },
                }),
            }}),
       {});

   check(psibase::show(show, trace) == "", "Failed to deploy genesis contracts");
}

void DefaultTestChain::createSysContractAccounts(bool show /* = false */)
{
   transactor<system_contract::AccountSys>     asys{system_contract::TransactionSys::contract,
                                                system_contract::AccountSys::contract};
   transactor<system_contract::TransactionSys> tsys{system_contract::TransactionSys::contract,
                                                    system_contract::TransactionSys::contract};
   auto trace = pushTransaction(makeTransaction({asys.startup(), tsys.startup()}));

   check(psibase::show(show, trace) == "", "Failed to create system contract accounts");
}

AccountNumber DefaultTestChain::add_account(
    AccountNumber acc,
    AccountNumber authContract /* = AccountNumber("auth-any-sys") */,
    bool          show /* = false */)
{
   transactor<system_contract::AccountSys> asys(system_contract::TransactionSys::contract,
                                                system_contract::AccountSys::contract);

   auto trace = pushTransaction(  //
       makeTransaction({asys.newAccount(acc, authContract, true)}));

   check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::add_account(
    const char*   acc,
    AccountNumber authContract /* = AccountNumber("auth-any-sys")*/,
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

   auto trace = pushTransaction(makeTransaction({
       asys.newAccount(name, system_contract::AuthAnySys::contract, true),
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
   add_account(acc, system_contract::AuthAnySys::contract, show);

   transactor<system_contract::SetCodeSys> scsys{acc, system_contract::SetCodeSys::contract};

   auto trace =
       pushTransaction(makeTransaction({{scsys.setCode(acc, 0, 0, readWholeFile(filename))}}));

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
       transactor<ProxySys>{ProxySys::contract, r}.registerServer(RProxySys::contract),
       transactor<ProxySys>{PsiSpaceSys::contract, r}.registerServer(PsiSpaceSys::contract),
   };

   auto trace = pushTransaction(makeTransaction(std::move(a)));
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
       rpcCommon.storeSys("/index.html", html, readWholeFile(comDir + "/ui/index.html")),
       rpcCommon.storeSys("/ui/common.index.html", html,
                          readWholeFile(comDir + "/ui/common.index.html")),

       rpcCommon.storeSys("/common/rpc.mjs", js, readWholeFile(comDir + "/common/rpc.mjs")),
       rpcCommon.storeSys("/common/useGraphQLQuery.mjs", js,
                          readWholeFile(comDir + "/common/useGraphQLQuery.mjs")),
       rpcCommon.storeSys("/common/SimpleUI.mjs", js,
                          readWholeFile(comDir + "/common/SimpleUI.mjs")),
       rpcCommon.storeSys("/common/keyConversions.mjs", js,
                          readWholeFile(comDir + "/common/keyConversions.mjs")),
       rpcCommon.storeSys("/common/widgets.mjs", js, readWholeFile(comDir + "/common/widgets.mjs")),
       rpcCommon.storeSys("/ui/index.js", js, readWholeFile(comDir + "/ui/index.js")),

       // CommonSys - 3rd party
       rpcCommon.storeSys("/common/iframeResizer.js", js,
                          readWholeFile(thirdPty + "/iframeResizer.js")),
       rpcCommon.storeSys("/common/iframeResizer.contentWindow.js", js,
                          readWholeFile(thirdPty + "/iframeResizer.contentWindow.js")),
       rpcCommon.storeSys("/common/react.production.min.js", js,
                          readWholeFile(thirdPty + "/react.production.min.js")),
       rpcCommon.storeSys("/common/react-dom.production.min.js", js,
                          readWholeFile(thirdPty + "/react-dom.production.min.js")),
       rpcCommon.storeSys("/common/react-router-dom.min.js", js,
                          readWholeFile(thirdPty + "/react-router-dom.min.js")),
       rpcCommon.storeSys("/common/htm.module.js", js, readWholeFile(thirdPty + "/htm.module.js")),
       rpcCommon.storeSys("/common/react.development.js", js,
                          readWholeFile(thirdPty + "/react.development.js")),
       rpcCommon.storeSys("/common/react-dom.development.js", js,
                          readWholeFile(thirdPty + "/react-dom.development.js")),
       rpcCommon.storeSys("/common/semantic-ui-react.min.js", js,
                          readWholeFile(thirdPty + "/semantic-ui-react.min.js")),
       rpcCommon.storeSys("/common/use-local-storage-state.mjs", js,
                          readWholeFile(thirdPty + "/useLocalStorageState.js")),

       // AccountSys
       rpcAccount.storeSys("/index.html", html, readWholeFile(accDir + "/ui/index.html")),
       rpcAccount.storeSys("/ui/index.js", js, readWholeFile(accDir + "/ui/index.js")),

       // AuthEcSys
       rpcAuthEc.storeSys("/index.html", html, readWholeFile(authEcDir + "/ui/index.html")),
       rpcAuthEc.storeSys("/ui/index.js", js, readWholeFile(authEcDir + "/ui/index.js")),

       // ExploreSys
       rpcExplore.storeSys("/ui/index.js", js, readWholeFile(expDir + "/ui/index.js"))};

   trace = pushTransaction(makeTransaction(std::move(b)));
   check(psibase::show(false, trace) == "", "Failed to add UI files to system rpc contracts");
}