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
   auto packages = DirectoryRegistry("share/psibase/packages").resolve(names);
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
