#include <psibase/DefaultTestChain.hpp>

#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/CommonSys.hpp>
#include <services/system/CpuSys.hpp>
#include <services/system/ProducerSys.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/RAccountSys.hpp>
#include <services/system/RAuthEcSys.hpp>
#include <services/system/RProducerSys.hpp>
#include <services/system/RProxySys.hpp>
#include <services/system/SetCodeSys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/VerifyEcSys.hpp>
#include <services/user/AuthInviteSys.hpp>
#include <services/user/CoreFractalSys.hpp>
#include <services/user/ExploreSys.hpp>
#include <services/user/FractalSys.hpp>
#include <services/user/InviteSys.hpp>
#include <services/user/NftSys.hpp>
#include <services/user/PackageSys.hpp>
#include <services/user/PsiSpaceSys.hpp>
#include <services/user/RTokenSys.hpp>
#include <services/user/SymbolSys.hpp>
#include <services/user/TokenSys.hpp>
#include <utility>
#include <vector>

using namespace psibase;
using namespace SystemService;
using namespace UserService;

namespace
{
#ifdef __wasm32__
   struct InitCwd
   {
      InitCwd()
      {
         if (char* pwd = std::getenv("PWD"))
         {
            ::chdir(pwd);
         }
      }
   };
   InitCwd initCwd;
#endif

   void pushGenesisTransaction(DefaultTestChain& chain, std::span<PackagedService> service_packages)
   {
      std::vector<GenesisService> services;
      for (auto& s : service_packages)
      {
         s.genesis(services);
      }

      auto trace = chain.pushTransaction(  //
          chain.makeTransaction(           //
              {                            //
               // TODO: set sender,service,method in a way that's helpful to block explorers
               Action{.sender  = AccountNumber{"foo"},  // ignored
                      .service = AccountNumber{"bar"},  // ignored
                      .method  = {},
                      .rawData = psio::convert_to_frac(
                          GenesisActionData{.services = std::move(services)})}}),
          {});

      check(psibase::show(false, trace) == "", "Failed to deploy genesis services");
   }

   std::vector<Action> getInitialActions(std::span<PackagedService> service_packages,
                                         bool                       installUI)
   {
      transactor<AccountSys>     asys{AccountSys::service, AccountSys::service};
      transactor<TransactionSys> tsys{TransactionSys::service, TransactionSys::service};
      std::vector<Action>        actions;
      bool                       has_package_sys = false;
      for (auto& s : service_packages)
      {
         for (auto account : s.accounts())
         {
            if (account == PackageSys::service)
            {
               has_package_sys = true;
            }
            if (!s.hasService(account))
            {
               actions.push_back(asys.newAccount(account, AuthAnySys::service, true));
            }
         }

         if (installUI)
         {
            s.regServer(actions);
            s.storeData(actions);
         }

         s.postinstall(actions);
      }

      transactor<ProducerSys> psys{ProducerSys::service, ProducerSys::service};
      std::vector<Producer>   producerConfig = {{"firstproducer"_a, {}}};
      actions.push_back(psys.setProducers(producerConfig));

      if (has_package_sys)
      {
         for (auto& s : service_packages)
         {
            s.commitInstall(actions);
         }
      }

      actions.push_back(tsys.finishBoot());

      return actions;
   }

   std::vector<SignedTransaction> makeTransactions(TestChain& chain, std::vector<Action>&& actions)
   {
      std::vector<SignedTransaction> result;
      std::vector<Action>            group;
      std::size_t                    size = 0;
      for (auto& act : actions)
      {
         size += act.rawData.size();
         group.push_back(std::move(act));
         if (size >= 1024 * 1024)
         {
            result.push_back(SignedTransaction{chain.makeTransaction(std::move(group))});
            size = 0;
         }
      }
      if (!group.empty())
      {
         result.push_back(SignedTransaction{chain.makeTransaction(std::move(group))});
      }
      return result;
   }
}  // namespace

DefaultTestChain::DefaultTestChain(const std::vector<std::string>& names,
                                   bool                            installUI,
                                   const DatabaseConfig&           dbconfig)
    : TestChain(dbconfig)
{
   auto packageRoot = std::getenv("PSIBASE_DATADIR");
   check(!!packageRoot, "Cannot find package directory: PSIBASE_DATADIR not defined");
   auto packages = DirectoryRegistry(std::string(packageRoot) + "/packages").resolve(names);
   setAutoBlockStart(false);
   startBlock();
   pushGenesisTransaction(*this, packages);
   auto transactions = makeTransactions(*this, getInitialActions(packages, installUI));
   std::vector<Checksum256> transactionIds;
   for (const auto& trx : transactions)
   {
      transactionIds.push_back(sha256(trx.transaction.data(), trx.transaction.size()));
   }
   auto trace = pushTransaction(
       makeTransaction(
           {transactor<TransactionSys>{TransactionSys::service, TransactionSys::service}.startBoot(
               transactionIds)}),
       {});
   check(psibase::show(false, trace) == "", "Failed to boot");
   startBlock();
   setAutoBlockStart(true);
   for (const auto& trx : transactions)
   {
      auto trace = pushTransaction(trx);
      check(psibase::show(false, trace) == "", "Failed to boot");
   }
}

AccountNumber DefaultTestChain::addAccount(
    AccountNumber acc,
    AccountNumber authService /* = AccountNumber("auth-any-sys") */,
    bool          show /* = false */)
{
   transactor<AccountSys> asys(AccountSys::service, AccountSys::service);

   auto trace = pushTransaction(  //
       makeTransaction({asys.newAccount(acc, authService, true)}));

   check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::addAccount(
    const char*   acc,
    AccountNumber authService /* = AccountNumber("auth-any-sys")*/,
    bool          show /* = false */)
{
   return addAccount(AccountNumber(acc), authService, show);
}

AccountNumber DefaultTestChain::addAccount(AccountNumber    name,
                                           const PublicKey& public_key,
                                           bool             show /* = false */)
{
   transactor<AccountSys> asys(AccountSys::service, AccountSys::service);
   transactor<AuthEcSys>  ecsys(AuthEcSys::service, AuthEcSys::service);

   auto trace = pushTransaction(makeTransaction({
       asys.newAccount(name, AuthAnySys::service, true),
       ecsys.from(name).setKey(public_key),
       asys.from(name).setAuthServ(AuthEcSys::service),
   }));

   check(psibase::show(show, trace) == "", "Failed to add ec account");
   return name;
}  // addAccount()

AccountNumber DefaultTestChain::addAccount(const char*      name,
                                           const PublicKey& public_key,
                                           bool             show /* = false */)
{
   return addAccount(AccountNumber(name), public_key, show);
}

void DefaultTestChain::setAuthEc(AccountNumber    name,
                                 const PublicKey& pubkey,
                                 bool             show /* = false */)
{
   auto n  = name.str();
   auto t1 = from(name).to<AuthEcSys>().setKey(pubkey);
   check(psibase::show(show, t1.trace()) == "", "Failed to setkey for " + n);
   auto t2 = from(name).to<AccountSys>().setAuthServ(AuthEcSys::service);
   check(psibase::show(show, t2.trace()) == "", "Failed to setAuthServ for " + n);
}

AccountNumber DefaultTestChain::addService(AccountNumber acc,
                                           const char*   filename,
                                           bool          show /* = false */)
{
   addAccount(acc, AuthAnySys::service, show);

   transactor<SetCodeSys> scsys{acc, SetCodeSys::service};

   auto trace =
       pushTransaction(makeTransaction({{scsys.setCode(acc, 0, 0, readWholeFile(filename))}}));

   check(psibase::show(show, trace) == "", "Failed to create service");

   return acc;
}  // addService()

AccountNumber DefaultTestChain::addService(AccountNumber acc,
                                           const char*   filename,
                                           std::uint64_t flags,
                                           bool          show /* = false */)
{
   addAccount(acc, AuthAnySys::service, show);

   transactor<SetCodeSys> scsys{acc, SetCodeSys::service};
   auto                   setFlags =
       transactor<SetCodeSys>{SetCodeSys::service, SetCodeSys::service}.setFlags(acc, flags);

   auto trace = pushTransaction(
       makeTransaction({{scsys.setCode(acc, 0, 0, readWholeFile(filename)), setFlags}}));

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
   std::vector<Action> a{
       transactor<ProxySys>{AccountSys::service, r}.registerServer(RAccountSys::service),
       transactor<ProxySys>{AuthEcSys::service, r}.registerServer(RAuthEcSys::service),
       transactor<ProxySys>{CommonSys::service, r}.registerServer(CommonSys::service),
       transactor<ProxySys>{ExploreSys::service, r}.registerServer(ExploreSys::service),
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
   transactor<RTokenSys>   rpcToken(RTokenSys::service, RTokenSys::service);

   // Store UI files
   std::string cdir      = "../services";
   std::string comDir    = cdir + "/user/CommonSys";
   std::string accDir    = cdir + "/system/AccountSys";
   std::string expDir    = cdir + "/user/ExploreSys";
   std::string psiSpDir  = cdir + "/user/PsiSpaceSys";
   std::string tokDir    = cdir + "/user/TokenSys";
   std::string authEcDir = cdir + "/system/AuthEcSys";
   std::string thirdPty  = comDir + "/common/thirdParty/src";

   const std::string html = "text/html";
   const std::string js   = "text/javascript";
   const std::string css  = "text/css";
   const std::string ttf  = "font/ttf";
   const std::string svg  = "image/svg+xml";

   std::vector<Action> b{
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
       rpcCommon.storeSys("/app-psispace-mobile.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-psispace-mobile.svg")),
       rpcCommon.storeSys("/app-psispace-mobile.svg", svg,
                          readWholeFile(comDir + "/ui/dist/app-psispace-mobile.svg")),

       // CommonSys Other
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
       rpcCommon.storeSys("/common/fonts/raleway.css", css,
                          readWholeFile(comDir + "/common/fonts/raleway.css")),
       rpcCommon.storeSys("/common/fonts/raleway-variable-italic.ttf", ttf,
                          readWholeFile(comDir + "/common/fonts/raleway-variable-italic.ttf")),
       rpcCommon.storeSys("/common/fonts/raleway-variable-normal.ttf", ttf,
                          readWholeFile(comDir + "/common/fonts/raleway-variable-normal.ttf")),
       rpcCommon.storeSys("/common/fonts/red-hat-mono.css", css,
                          readWholeFile(comDir + "/common/fonts/red-hat-mono.css")),
       rpcCommon.storeSys("/common/fonts/red-hat-mono-variable-normal.ttf", ttf,
                          readWholeFile(comDir + "/common/fonts/red-hat-mono-variable-normal.ttf")),

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

       // AccountSys Fancy UI
       rpcAccount.storeSys("/app-account.svg", svg,
                           readWholeFile(accDir + "/ui/dist/app-account.svg")),
       rpcAccount.storeSys("/index.html", html, readWholeFile(accDir + "/ui/dist/index.html")),

       rpcAccount.storeSys("/index.js", js, readWholeFile(accDir + "/ui/dist/index.js")),
       rpcAccount.storeSys("/lock-closed.svg", svg,
                           readWholeFile(accDir + "/ui/dist/lock-closed.svg")),
       rpcAccount.storeSys("/lock-open.svg", svg, readWholeFile(accDir + "/ui/dist/lock-open.svg")),
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
       rpcPsiSpace.storeSys("/app-psispace-icon.svg", svg,
                            readWholeFile(psiSpDir + "/ui/dist/app-psispace-icon.svg")),
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

       // TokenSys
       rpcToken.storeSys("/index.html", html, readWholeFile(tokDir + "/ui/dist/index.html")),
       rpcToken.storeSys("/index.js", js, readWholeFile(tokDir + "/ui/dist/index.js")),
       rpcToken.storeSys("/style.css", css, readWholeFile(tokDir + "/ui/dist/style.css")),
       rpcToken.storeSys("/loader.svg", svg, readWholeFile(tokDir + "/ui/dist/loader.svg")),
       rpcToken.storeSys("/app-wallet-icon.svg", svg,
                         readWholeFile(tokDir + "/ui/dist/app-wallet-icon.svg")),
       rpcToken.storeSys("/arrow-up-solid.svg", svg,
                         readWholeFile(tokDir + "/ui/dist/arrow-up-solid.svg")),
   };

   trace = pushTransaction(makeTransaction(std::move(b)));
   check(psibase::show(false, trace) == "", "Failed to add UI files to system rpc services");
}
