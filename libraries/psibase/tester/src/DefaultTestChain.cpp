#include <psibase/DefaultTestChain.hpp>

#include <psibase/fileUtil.hpp>
#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/Producers.hpp>
#include <services/system/SetCode.hpp>

#include <utility>
#include <vector>

using namespace psibase;
using namespace SystemService;
using namespace UserService;

namespace
{
   // These are the services that MUST be installed at genesis
   // - Anything that is used in the genesis block
   // - SetCode to install the remaining services at the beginning
   //   of the next block.
   //
   // Every verifier that is being installed goes into the genesis block
   // too. The set of verify services is part of the consensus state: after
   // genesis it changes one block at a time, and a change cannot begin
   // while another is pending, so verifiers installed by separate
   // transactions of a boot would be refused.
   const std::vector<AccountNumber> essentialServices = []
   {
      std::vector<AccountNumber> result{Transact::service, SetCode::service};
      for (auto type : {KeyType::secp256k1, KeyType::secp256r1})
         for (auto service : allowedVerifiers(type))
            result.push_back(service);
      return result;
   }();

   // Returns the number of leading packages up to and including
   // the last one containing an essential service.
   std::size_t countEssentialPackages(std::span<PackagedService> packages)
   {
      auto iter = packages.rbegin();
      auto end  = packages.rend();
      for (; iter != end; ++iter)
      {
         for (auto account : iter->meta.services)
         {
            if (std::ranges::contains(essentialServices, account))
            {
               return end - iter;
            }
         }
      }
      return end - iter;
   }

   void pushGenesisTransaction(TestChain&                 chain,
                               std::span<PackagedService> service_packages,
                               std::size_t                priority_count)
   {
      std::vector<GenesisService> services;
      for (auto& s : service_packages.subspan(0, priority_count))
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
                      .rawData = psio::to_pssz(
                          GenesisActionData{.services = std::move(services)})}}),
          {});

      check(psibase::show(false, trace) == "", "Failed to deploy genesis services");
   }

   std::vector<Action> getInitialActions(std::span<PackagedService> service_packages,
                                         std::size_t                priority_count,
                                         bool                       installUI)
   {
      transactor<Accounts> asys{Accounts::service, Accounts::service};
      transactor<Transact> tsys{Transact::service, Transact::service};
      std::vector<Action>  actions;
      bool                 has_packages = false;

      for (auto& s : service_packages.subspan(priority_count))
      {
         s.installCode(actions);
      }

      for (auto& s : service_packages)
      {
         s.setSchema(actions);
      }

      transactor<Producers> psys{Producers::service, Producers::service};
      std::vector<Producer> producerConfig = {{"firstprod"_a, {}}};
      actions.push_back(psys.setProducers(producerConfig));

      for (auto& s : service_packages)
      {
         for (auto account : s.accounts())
         {
            if (account == Packages::service)
            {
               has_packages = true;
            }
            if (!s.hasService(account))
            {
               actions.push_back(
                   asys.newAccount(account, AuthDelegate::service, NewAccountMode::matchExisting));
            }
         }

         s.regServer(actions);

         if (installUI || s.needsUI())
         {
            s.storeData(actions);
         }

         s.postinstall(actions, service_packages);
      }

      auto producer = "firstprod"_a;
      actions.push_back(
          transactor<Accounts>{producer, Accounts::service}.setAuthServ(AuthAny::service));

      auto root = AccountNumber{"root"};
      actions.push_back(asys.newAccount(root, AuthAny::service, NewAccountMode::requireNew));

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
            }
         }
      }

      if (has_packages)
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
      std::vector<std::vector<Action>> groups;
      std::vector<Action>              group;
      std::size_t                      size  = 0;
      const std::size_t                limit = 1024 * 1024;
      auto                             flush = [&]
      {
         groups.push_back(std::move(group));
         group.clear();
         size = 0;
      };
      for (auto& act : actions)
      {
         // A large action (a UI's biggest file is several MiB) goes into a
         // transaction of its own. Added to a group already near the limit
         // it made a transaction of group + action, which with the largest
         // files was just under a block's size and went over it, into a
         // block no node would replay, when a package grew by a few bytes.
         if (!group.empty() && size + act.rawData.size() > limit)
            flush();
         size += act.rawData.size();
         group.push_back(std::move(act));
         if (size >= limit)
            flush();
      }
      if (!group.empty())
         flush();
      // Boot pushes one of these per block, a second apart: the last one must
      // not have expired when its turn comes.
      auto expireSeconds = static_cast<int>(groups.size()) + 30;
      std::vector<SignedTransaction> result;
      for (auto& g : groups)
      {
         result.push_back(SignedTransaction{
             psio::shared_pssz<Transaction>{chain.makeTransaction(std::move(g), expireSeconds)}});
      }
      return result;
   }

   DefaultTestChain& defaultChainInstance()
   {
      static DefaultTestChain result{DefaultTestChain::defaultPackages(), false, {}, false};
      return result;
   }

}  // namespace

std::string TestChain::defaultPackageDir()
{
   auto packageRoot = std::getenv("PSIBASE_DATADIR");
   check(!!packageRoot, "Cannot find package directory: PSIBASE_DATADIR not defined");
   return std::string(packageRoot) + "/packages";
}

void TestChain::boot(const std::vector<std::string>& names, bool installUI)
{
   auto registry = DirectoryRegistry(defaultPackageDir());
   auto packages = registry.resolve(names, essentialServices);
   setAutoBlockStart(false);
   startBlock();
   auto numEssential = countEssentialPackages(packages);
   pushGenesisTransaction(*this, packages, numEssential);
   auto transactions =
       makeTransactions(*this, getInitialActions(packages, numEssential, installUI));
   std::vector<Checksum256> transactionIds;
   for (const auto& trx : transactions)
   {
      transactionIds.push_back(sha256(trx.transaction.data(), trx.transaction.size()));
   }
   auto trace = pushTransaction(
       makeTransaction(
           {transactor<Transact>{Transact::service, Transact::service}.startBoot(transactionIds)}),
       {});
   if (auto error = psibase::show(false, trace); error != "")
         abortMessage("Failed to boot: " + error);
   for (const auto& trx : transactions)
   {
      startBlock();
      auto trace = pushTransaction(trx);
      if (auto error = psibase::show(false, trace); error != "")
         abortMessage("Failed to boot: " + error);
   }
   setAutoBlockStart(true);
   startBlock();
}

std::vector<std::string> DefaultTestChain::defaultPackages()
{
   return {"Accounts", "AuthAny",     "AuthDelegate", "AuthNone",   "AuthSig", "CommonApi",
           "CpuLimit", "Credentials", "Events",       "Explorer",   "Invite",
           "Nft",      "Packages",    "Producers",    "HttpServer", "Sites",
           "SetCode",  "StagedTx",    "Symbol",       "Tokens",     "Transact"};
}

DefaultTestChain::DefaultTestChain() : TestChain(defaultChainInstance(), true)
{
   startBlock();
}

DefaultTestChain::DefaultTestChain(const std::vector<std::string>& names,
                                   bool                            installUI,
                                   const DatabaseConfig&           dbconfig,
                                   bool                            pub)
    : TestChain(dbconfig, pub)
{
   boot(names, installUI);
}

AccountNumber DefaultTestChain::addAccount(
    AccountNumber acc,
    AccountNumber authService /* = AccountNumber("auth-any") */,
    bool          show /* = false */)
{
   transactor<Accounts> asys(Accounts::service, Accounts::service);

   auto trace = pushTransaction(  //
       makeTransaction({asys.newAccount(acc, authService, NewAccountMode::requireNew)}));

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

AccountNumber DefaultTestChain::addAccount(AccountNumber                        name,
                                           const AuthSig::SubjectPublicKeyInfo& public_key,
                                           bool                                 show /* = false */)
{
   transactor<Accounts>         accounts(Accounts::service, Accounts::service);
   transactor<AuthSig::AuthSig> authsig(AuthSig::AuthSig::service, AuthSig::AuthSig::service);

   auto trace = pushTransaction(makeTransaction({
       accounts.newAccount(name, AuthAny::service, NewAccountMode::requireNew),
       authsig.from(name).setKeys(AuthSig::KeySpec::of(public_key),
                                  AuthSig::KeySpec::of(public_key)),
       accounts.from(name).setAuthServ(AuthSig::AuthSig::service),
   }));

   check(psibase::show(show, trace) == "", "Failed to add authenticated account");
   return name;
}  // addAccount()

AccountNumber DefaultTestChain::addAccount(const char*                          name,
                                           const AuthSig::SubjectPublicKeyInfo& public_key,
                                           bool                                 show /* = false */)
{
   return addAccount(AccountNumber(name), public_key, show);
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
