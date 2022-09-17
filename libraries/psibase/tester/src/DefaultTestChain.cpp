#include <psibase/DefaultTestChain.hpp>

#include <psibase/serviceEntry.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/CommonSys.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/RAccountSys.hpp>
#include <services/system/RAuthEcSys.hpp>
#include <services/system/RProxySys.hpp>
#include <services/system/SetCodeSys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/VerifyEcSys.hpp>
#include <services/user/ExploreSys.hpp>
#include <services/user/PsiSpaceSys.hpp>
#include <utility>
#include <vector>

using namespace psibase;
using namespace SystemService;

DefaultTestChain::DefaultTestChain(
    const std::vector<std::pair<AccountNumber, const char*>>& additionalServices,
    uint64_t                                                  max_objects,
    uint64_t                                                  hot_addr_bits,
    uint64_t                                                  warm_addr_bits,
    uint64_t                                                  cool_addr_bits,
    uint64_t                                                  cold_addr_bits)
    : TestChain{max_objects, hot_addr_bits, warm_addr_bits, cool_addr_bits, cold_addr_bits}
{
   startBlock();
   deploySystemServices();
   startBlock();
   createSysServiceAccounts();
   registerSysRpc();

   for (const auto& c : additionalServices)
   {
      addService(c.first, c.second);
   }
}

void DefaultTestChain::deploySystemServices(bool show /* = false */)
{
   auto
       trace =
           pushTransaction(      //
               makeTransaction(  //
                   {             //
                    Action{
                        .sender  = AccountNumber{"foo"},  // ignored
                        .service = AccountNumber{"bar"},  // ignored
                        .method  = {},
                        .rawData =
                            psio::convert_to_frac(
                                GenesisActionData{
                                    .services =
                                        {
                                            {
                                                .service = SystemService::TransactionSys::service,
                                                .flags =
                                                    SystemService::TransactionSys::serviceFlags,
                                                .code = readWholeFile("TransactionSys.wasm"),
                                            },
                                            {
                                                .service = SystemService::SetCodeSys::service,
                                                .flags   = SystemService::SetCodeSys::serviceFlags,
                                                .code    = readWholeFile("SetCodeSys.wasm"),
                                            },
                                            {
                                                .service = SystemService::AccountSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("AccountSys.wasm"),
                                            },
                                            {
                                                .service = ProxySys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("ProxySys.wasm"),
                                            },
                                            {
                                                .service = SystemService::AuthAnySys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("AuthAnySys.wasm"),
                                            },
                                            {
                                                .service = SystemService::AuthEcSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("AuthEcSys.wasm"),
                                            },
                                            {
                                                .service = SystemService::VerifyEcSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("VerifyEcSys.wasm"),
                                            },
                                            {
                                                .service = CommonSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("CommonSys.wasm"),
                                            },
                                            {
                                                .service = RAccountSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("RAccountSys.wasm"),
                                            },
                                            {
                                                .service = ExploreSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("ExploreSys.wasm"),
                                            },
                                            {
                                                .service = RAuthEcSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("RAuthEcSys.wasm"),
                                            },
                                            {
                                                .service = RProxySys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("RProxySys.wasm"),
                                            },
                                            {
                                                .service = PsiSpaceSys::service,
                                                .flags   = 0,
                                                .code    = readWholeFile("PsiSpaceSys.wasm"),
                                            },
                                        },
                                }),
                    }}),
               {});

   check(psibase::show(show, trace) == "", "Failed to deploy genesis services");
}

void DefaultTestChain::createSysServiceAccounts(bool show /* = false */)
{
   transactor<SystemService::AccountSys>     asys{SystemService::TransactionSys::service,
                                              SystemService::AccountSys::service};
   transactor<SystemService::TransactionSys> tsys{SystemService::TransactionSys::service,
                                                  SystemService::TransactionSys::service};
   auto trace = pushTransaction(makeTransaction({asys.init(), tsys.init()}));

   check(psibase::show(show, trace) == "", "Failed to create system service accounts");
}

AccountNumber DefaultTestChain::add_account(
    AccountNumber acc,
    AccountNumber authService /* = AccountNumber("auth-any-sys") */,
    bool          show /* = false */)
{
   transactor<SystemService::AccountSys> asys(SystemService::TransactionSys::service,
                                              SystemService::AccountSys::service);

   auto trace = pushTransaction(  //
       makeTransaction({asys.newAccount(acc, authService, true)}));

   check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::add_account(
    const char*   acc,
    AccountNumber authService /* = AccountNumber("auth-any-sys")*/,
    bool          show /* = false */)
{
   return add_account(AccountNumber(acc), authService, show);
}

AccountNumber DefaultTestChain::add_ec_account(AccountNumber    name,
                                               const PublicKey& public_key,
                                               bool             show /* = false */)
{
   transactor<SystemService::AccountSys> asys(SystemService::AccountSys::service,
                                              SystemService::AccountSys::service);
   transactor<SystemService::AuthEcSys>  ecsys(SystemService::AuthEcSys::service,
                                               SystemService::AuthEcSys::service);

   auto trace = pushTransaction(makeTransaction({
       asys.newAccount(name, SystemService::AuthAnySys::service, true),
       ecsys.from(name).setKey(public_key),
       asys.from(name).setAuthCntr(SystemService::AuthEcSys::service),
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

AccountNumber DefaultTestChain::addService(AccountNumber acc,
                                           const char*   filename,
                                           bool          show /* = false */)
{
   add_account(acc, SystemService::AuthAnySys::service, show);

   transactor<SystemService::SetCodeSys> scsys{acc, SystemService::SetCodeSys::service};

   auto trace =
       pushTransaction(makeTransaction({{scsys.setCode(acc, 0, 0, readWholeFile(filename))}}));

   check(psibase::show(show, trace) == "", "Failed to create service");

   return acc;
}  // addService()

AccountNumber DefaultTestChain::addService(const char* acc,
                                           const char* filename,
                                           bool        show /* = false */)
{
   return addService(AccountNumber(acc), filename, show);
}

void DefaultTestChain::registerSysRpc()
{
   auto r = ProxySys::service;

   // Register servers
   std::vector<psibase::Action> a{
       transactor<ProxySys>{CommonSys::service, r}.registerServer(CommonSys::service),
       transactor<ProxySys>{AccountSys::service, r}.registerServer(RAccountSys::service),
       transactor<ProxySys>{ExploreSys::service, r}.registerServer(ExploreSys::service),
       transactor<ProxySys>{AuthEcSys::service, r}.registerServer(RAuthEcSys::service),
       transactor<ProxySys>{ProxySys::service, r}.registerServer(RProxySys::service),
       transactor<ProxySys>{PsiSpaceSys::service, r}.registerServer(PsiSpaceSys::service),
   };

   auto trace = pushTransaction(makeTransaction(std::move(a)));
   check(psibase::show(false, trace) == "", "Failed to register system rpc services");

   transactor<CommonSys>   rpcCommon(CommonSys::service, CommonSys::service);
   transactor<RAccountSys> rpcAccount(RAccountSys::service, RAccountSys::service);
   transactor<ExploreSys>  rpcExplore(ExploreSys::service, ExploreSys::service);
   transactor<RAuthEcSys>  rpcAuthEc(RAuthEcSys::service, RAuthEcSys::service);
   transactor<PsiSpaceSys> rpcPsiSpace(PsiSpaceSys::service, PsiSpaceSys::service);

   // Store UI files
   std::string cdir      = "../services";
   std::string comDir    = cdir + "/user/CommonSys";
   std::string accDir    = cdir + "/system/AccountSys";
   std::string expDir    = cdir + "/user/ExploreSys";
   std::string psiSpDir  = cdir + "/user/PsiSpaceSys";
   std::string authEcDir = cdir + "/system/AuthEcSys";
   std::string thirdPty  = comDir + "/common/thirdParty/src";

   const std::string html = "text/html";
   const std::string js   = "text/javascript";
   const std::string css  = "text/css";
   const std::string svg  = "image/svg+xml";

   std::vector<psibase::Action> b{
       // CommonSys Fancy UI
       rpcCommon.storeSys("/index.html", html, readWholeFile(comDir + "/ui/dist/index.html")),
       rpcCommon.storeSys("/index.js", js, readWholeFile(comDir + "/ui/dist/index.js")),
       rpcCommon.storeSys("/style.css", css, readWholeFile(comDir + "/ui/dist/style.css")),
       rpcCommon.storeSys("/ninebox.svg", svg, readWholeFile(comDir + "/ui/dist/ninebox.svg")),
       rpcCommon.storeSys("/loader.svg", svg, readWholeFile(comDir + "/ui/dist/loader.svg")),
       rpcCommon.storeSys("/psibase.svg", svg, readWholeFile(comDir + "/ui/dist/psibase.svg")),
       rpcCommon.storeSys("/app-account-desktop.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-account-desktop.svg")),
       rpcCommon.storeSys("/app-account-mobile.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-account-mobile.svg")),
       rpcCommon.storeSys("/app-explore-desktop.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-explore-desktop.svg")),
       rpcCommon.storeSys("/app-explore-mobile.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-explore-mobile.svg")),
       rpcCommon.storeSys("/app-wallet-desktop.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-wallet-desktop.svg")),
       rpcCommon.storeSys("/app-wallet-mobile.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-wallet-mobile.svg")),

       // CommonSys Basic UI
       //    rpcCommon.storeSys("/index.html", html, readWholeFile(comDir + "/ui/vanilla/index.html")),
       //    rpcCommon.storeSys("/ui/index.js", js, readWholeFile(comDir + "/ui/vanilla/index.js")),

       // CommonSys Other
       rpcCommon.storeSys("/ui/common.index.html", html,
                          readWholeFile(comDir + "/ui/vanilla/common.index.html")),

       rpcCommon.storeSys("/common/rpc.mjs", js, readWholeFile(comDir + "/common/rpc.mjs")),
       rpcCommon.storeSys("/common/useGraphQLQuery.mjs", js,
                          readWholeFile(comDir + "/common/useGraphQLQuery.mjs")),
       rpcCommon.storeSys("/common/useLocalStorage.mjs", js,
                          readWholeFile(comDir + "/common/useLocalStorage.mjs")),
       rpcCommon.storeSys("/common/SimpleUI.mjs", js,
                          readWholeFile(comDir + "/common/SimpleUI.mjs")),
       rpcCommon.storeSys("/common/keyConversions.mjs", js,
                          readWholeFile(comDir + "/common/keyConversions.mjs")),
       rpcCommon.storeSys("/common/widgets.mjs", js, readWholeFile(comDir + "/common/widgets.mjs")),

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

       // AccountSys Basic UI
       //    rpcAccount.storeSys("/index.html", html, readWholeFile(accDir + "/ui/vanilla/index.html")),
       //    rpcAccount.storeSys("/ui/index.js", js, readWholeFile(accDir + "/ui/vanilla/index.js")),

       // AccountSys Fancy UI
       rpcAccount.storeSys("/app-account.svg", svg,
                           readWholeFile(accDir + "/ui/dist/app-account.svg")),
       rpcAccount.storeSys("/index.html", html, readWholeFile(accDir + "/ui/dist/index.html")),
       rpcAccount.storeSys("/index.js", js, readWholeFile(accDir + "/ui/dist/index.js")),
       rpcAccount.storeSys("/logout.svg", svg, readWholeFile(accDir + "/ui/dist/logout.svg")),
       rpcAccount.storeSys("/refresh.svg", svg, readWholeFile(accDir + "/ui/dist/refresh.svg")),
       rpcAccount.storeSys("/style.css", css, readWholeFile(accDir + "/ui/dist/style.css")),

       // AuthEcSys
       rpcAuthEc.storeSys("/index.html", html, readWholeFile(authEcDir + "/ui/index.html")),
       rpcAuthEc.storeSys("/ui/index.js", js, readWholeFile(authEcDir + "/ui/index.js")),

       // ExploreSys
       //    rpcExplore.storeSys("/ui/index.js", js, readWholeFile(expDir + "/ui/index.js"))

       // PsiSpaceSys Fancy UI
       rpcPsiSpace.storeSys("/index.html", html, readWholeFile(psiSpDir + "/ui/dist/index.html")),
       rpcPsiSpace.storeSys("/index.js", js, readWholeFile(psiSpDir + "/ui/dist/index.js")),
       rpcPsiSpace.storeSys("/loader.svg", svg, readWholeFile(psiSpDir + "/ui/dist/loader.svg")),
       rpcPsiSpace.storeSys("/style.css", css, readWholeFile(psiSpDir + "/ui/dist/style.css")),
       rpcPsiSpace.storeSys(
           "/default-profile/default-profile.html", html,
           readWholeFile(psiSpDir + "/ui/dist/default-profile/default-profile.html")),
       rpcPsiSpace.storeSys("/default-profile/index.js", js,
                            readWholeFile(psiSpDir + "/ui/dist/default-profile/index.js")),
       rpcPsiSpace.storeSys("/default-profile/loader.svg", svg,
                            readWholeFile(psiSpDir + "/ui/dist/default-profile/loader.svg")),
       rpcPsiSpace.storeSys("/default-profile/style.css", css,
                            readWholeFile(psiSpDir + "/ui/dist/default-profile/style.css")),
   };

   trace = pushTransaction(makeTransaction(std::move(b)));
   check(psibase::show(false, trace) == "", "Failed to add UI files to system rpc services");
}