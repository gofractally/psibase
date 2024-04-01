#include <psibase/DefaultTestChain.hpp>

#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/CpuLimit.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Producers.hpp>
#include <services/system/RAccounts.hpp>
#include <services/system/RAuthK1.hpp>
#include <services/system/RHttpServer.hpp>
#include <services/system/RProducers.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifyK1.hpp>
#include <services/user/AuthInvite.hpp>
#include <services/user/CoreFractal.hpp>
#include <services/user/Explorer.hpp>
#include <services/user/Fractal.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Nft.hpp>
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
      transactor<Accounts> asys{Accounts::service, Accounts::service};
      transactor<Transact> tsys{Transact::service, Transact::service};
      std::vector<Action>  actions;
      bool                 has_package_sys = false;
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
               actions.push_back(asys.newAccount(account, AuthAny::service, true));
            }
         }

         if (installUI)
         {
            s.regServer(actions);
            s.storeData(actions);
         }

         s.postinstall(actions);
      }

      transactor<Producers> psys{Producers::service, Producers::service};
      std::vector<Producer> producerConfig = {{"firstproducer"_a, {}}};
      actions.push_back(psys.setProducers(producerConfig));

      auto root = AccountNumber{"root"};
      actions.push_back(asys.newAccount(root, AuthAny::service, true));

      // If a package sets an auth service for an account, we should not override it
      std::vector<AccountNumber> accountsWithAuth;
      for (const auto& act : actions)
      {
         if (act.service == Accounts::service && act.method == MethodNumber{"setAuthServ"})
         {
            accountsWithAuth.push_back(act.sender);
         }
      }
      std::ranges::sort(accountsWithAuth);

      for (auto& s : service_packages)
      {
         for (auto account : s.accounts())
         {
            if (!std::ranges::binary_search(accountsWithAuth, account))
            {
               actions.push_back(
                   transactor<AuthDelegate>{account, AuthDelegate::service}.setOwner(root));
               actions.push_back(asys.from(account).setAuthServ(AuthDelegate::service));
            }
         }
      }

      if (has_package_sys)
      {
         for (auto& s : service_packages)
         {
            s.commitInstall(actions, root);
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
           {transactor<Transact>{Transact::service, Transact::service}.startBoot(transactionIds)}),
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
    AccountNumber authService /* = AccountNumber("auth-any") */,
    bool          show /* = false */)
{
   transactor<Accounts> asys(Accounts::service, Accounts::service);

   auto trace = pushTransaction(  //
       makeTransaction({asys.newAccount(acc, authService, true)}));

   check(psibase::show(show, trace) == "", "Failed to add account");

   return acc;
}

AccountNumber DefaultTestChain::addAccount(
    const char*   acc,
    AccountNumber authService /* = AccountNumber("auth-any")*/,
    bool          show /* = false */)
{
   return addAccount(AccountNumber(acc), authService, show);
}

AccountNumber DefaultTestChain::addAccount(AccountNumber    name,
                                           const PublicKey& public_key,
                                           bool             show /* = false */)
{
   transactor<Accounts> asys(Accounts::service, Accounts::service);
   transactor<AuthK1>   ecsys(AuthK1::service, AuthK1::service);

   auto trace = pushTransaction(makeTransaction({
       asys.newAccount(name, AuthAny::service, true),
       ecsys.from(name).setKey(public_key),
       asys.from(name).setAuthServ(AuthK1::service),
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

void DefaultTestChain::setAuthK1(AccountNumber    name,
                                 const PublicKey& pubkey,
                                 bool             show /* = false */)
{
   auto n  = name.str();
   auto t1 = from(name).to<AuthK1>().setKey(pubkey);
   check(psibase::show(show, t1.trace()) == "", "Failed to setkey for " + n);
   auto t2 = from(name).to<Accounts>().setAuthServ(AuthK1::service);
   check(psibase::show(show, t2.trace()) == "", "Failed to setAuthServ for " + n);
}

AccountNumber DefaultTestChain::addService(AccountNumber acc,
                                           const char*   filename,
                                           bool          show /* = false */)
{
   addAccount(acc, AuthAny::service, show);

   transactor<SetCode> scsys{acc, SetCode::service};

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
   addAccount(acc, AuthAny::service, show);

   transactor<SetCode> scsys{acc, SetCode::service};
   auto setFlags = transactor<SetCode>{SetCode::service, SetCode::service}.setFlags(acc, flags);

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
