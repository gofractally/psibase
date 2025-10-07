#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <ranges>
#include <services/system/Accounts.hpp>
#include <services/system/Producers.hpp>

using namespace psibase;
using namespace SystemService;

namespace
{
   auto compare_claim = [](const Claim& lhs, const Claim& rhs)
   { return std::tie(lhs.service, lhs.rawData) < std::tie(rhs.service, rhs.rawData); };

   bool satisfiesClaim(const Claim& expected, const std::vector<Claim>& claims_sorted)
   {
      return expected == Claim{} ||
             std::ranges::binary_search(claims_sorted, expected, compare_claim);
   }

   std::size_t getThreshold(const CftConsensus& cft, AccountNumber account)
   {
      if (account == SystemService::Producers::producerAccountWeak)
         return 1;
      else
         return cft.producers.size() / 2 + 1;
   }

   std::size_t getThreshold(const BftConsensus& bft, AccountNumber account)
   {
      if (account == SystemService::Producers::producerAccountWeak)
         return (bft.producers.size() + 2) / 3;
      else
         return bft.producers.size() * 2 / 3 + 1;
   }

   std::size_t getNrProds()
   {
      return std::visit([&](const auto& c) { return c.producers.size(); },
                        getStatus().consensus.current.data);
   }

   std::vector<Producer> getProducers()
   {
      return std::visit([](const auto& c) -> std::vector<Producer>
                        { return std::move(c.producers); }, getStatus().consensus.current.data);
   }

   std::vector<Producer> getNextProducers()
   {
      auto status = getStatus();
      if (!status.consensus.next)
         return {};
      return std::visit([](const auto& c) -> std::vector<Producer>
                        { return std::move(c.producers); }, status.consensus.next->consensus.data);
   }

   using IndirectCheckFunc =
       bool (Actor<SystemService::AuthInterface>::*)(AccountNumber,
                                                     std::vector<AccountNumber>,
                                                     std::optional<std::vector<AccountNumber>>);

   bool checkOverlapping(std::vector<AccountNumber> producers,
                         std::vector<AccountNumber> authorizers,
                         std::size_t                threshold,
                         IndirectCheckFunc          indirectCheck,
                         std::vector<AccountNumber> authSet)
   {
      // We only check for indirect auth if there are insufficient direct auths.
      auto nonOverlapping = std::ranges::partition(
          producers, [&](const auto& p) { return std::ranges::contains(authorizers, p); });
      auto numOverlapping = std::ranges::distance(producers.begin(), nonOverlapping.begin());
      if (numOverlapping >= threshold)
      {
         return true;
      }

      // Now check for indirect authorization
      for (const auto& account :
           std::ranges::subrange(nonOverlapping.begin(), nonOverlapping.end()))
      {
         auto toAuth = Actor<SystemService::AuthInterface>{
             SystemService::Producers::service, to<SystemService::Accounts>().getAuthOf(account)};

         if ((toAuth.*indirectCheck)(account, authorizers, std::optional(std::move(authSet))) &&
             ++numOverlapping >= threshold)
         {
            return true;
         }
      }

      return false;
   }

}  // namespace

namespace SystemService
{
   // Verifies that all the auth services have the correct flags set
   static void checkVerifyServices(const std::vector<psibase::Producer>& producers)
   {
      std::vector<AccountNumber> accounts;
      for (const auto& [name, auth] : producers)
      {
         if (auth != Claim{})
         {
            accounts.push_back(auth.service);
         }
      }
      std::sort(accounts.begin(), accounts.end());
      accounts.erase(std::unique(accounts.begin(), accounts.end()), accounts.end());
      auto codeTable = Native::tables(KvMode::read).open<CodeTable>();
      for (AccountNumber account : accounts)
      {
         auto code = codeTable.get(account);
         check(!!code, "Unknown service account: " + account.str());
         check(code->flags & CodeRow::isVerify,
               "Service account " + account.str() + " cannot be used for block production");
      }
   }

   void Producers::setConsensus(psibase::ConsensusData consensus)
   {
      check(getSender() == getReceiver(), "sender must match service account");
      auto table  = Native::tables().open<StatusRow>();
      auto status = table.get({});
      std::visit(
          [](const auto& c)
          {
             check(!c.producers.empty(), "There must be at least one producer");
             checkVerifyServices(c.producers);
          },
          consensus);
      check(!!status, "Missing status row");
      check(!status->consensus.next || status->consensus.next->blockNum == status->current.blockNum,
            "Consensus update pending");
      status->consensus.next = {{std::move(consensus), status->consensus.current.services,
                                 status->consensus.current.wasmConfig},
                                status->current.blockNum};
      table.put(*status);
   }

   void Producers::setProducers(std::vector<psibase::Producer> prods)
   {
      check(getSender() == getReceiver(), "sender must match service account");
      auto table  = Native::tables().open<StatusRow>();
      auto status = table.get({});
      check(!prods.empty(), "There must be at least one producer");
      checkVerifyServices(prods);
      check(!!status, "Missing status row");
      check(!status->consensus.next || status->consensus.next->blockNum == status->current.blockNum,
            "Consensus update pending");
      status->consensus.next = {
          {std::visit(
               [&](auto old)
               {
                  old.producers = std::move(prods);
                  return ConsensusData{std::move(old)};
               },
               status->consensus.current.data),
           status->consensus.current.services, status->consensus.current.wasmConfig},
          status->current.blockNum};
      table.put(*status);
   }

   void Producers::regCandidate(const std::string& endpoint, psibase::Claim claim)
   {
      Tables().open<CandidateInfoTable>().put(CandidateInfo{getSender(), endpoint, claim});
   }

   void Producers::unregCandidate()
   {
      auto sender = getSender();

      auto producers = ::getProducers();
      check(!std::ranges::contains(producers, sender, &Producer::name),
            "Cannot unregister: account is an active producer");

auto nextProducers = ::getNextProducers();
      check(!std::ranges::contains(nextProducers, sender, &Producer::name),
            "Cannot unregister: account is scheduled to become a producer");

      Tables().open<CandidateInfoTable>().erase(sender);
   }

   std::vector<psibase::AccountNumber> Producers::getProducers()
   {
      return ::getProducers()                          //
             | std::views::transform(&Producer::name)  //
             | std::ranges::to<std::vector>();
   }

   uint32_t Producers::getThreshold(AccountNumber account)
   {
      check(account == producerAccountWeak || account == producerAccountStrong, "Invalid account");
      auto threshold = std::visit([&](const auto& c) { return ::getThreshold(c, account); },
                                  getStatus().consensus.current.data);

      return threshold;
   }

   uint32_t Producers::antiThreshold(AccountNumber account)
   {
      return ::getNrProds() - getThreshold(account) + 1;
   }

   void Producers::checkAuthSys(uint32_t                    flags,
                                AccountNumber               requester,
                                AccountNumber               sender,
                                ServiceMethod               action,
                                std::vector<ServiceMethod>  allowedActions,
                                std::vector<psibase::Claim> claims)
   {
      // verify that all claims are valid

      // Standard verification for auth type
      // TODO: refactor duplicated code
      auto type = flags & AuthInterface::requestMask;
      if (type == AuthInterface::runAsRequesterReq)
         return;  // Request is valid
      else if (type == AuthInterface::runAsMatchedReq)
         return;  // Request is valid
      else if (type == AuthInterface::runAsMatchedExpandedReq)
         abortMessage("runAs: caller attempted to expand powers");
      else if (type == AuthInterface::runAsOtherReq)
         abortMessage("runAs: caller is not authorized");
      else if (type != AuthInterface::topActionReq)
         abortMessage("unsupported auth type");

      auto expectedClaims = ::getProducers()                          //
                            | std::views::transform(&Producer::auth)  //
                            | std::ranges::to<std::vector>();

      std::ranges::sort(claims, compare_claim);
      auto matching = std::ranges::count_if(expectedClaims, [&](const auto& expected) {  //
         return satisfiesClaim(expected, claims);
      });

      auto threshold = expectedClaims.empty() ? 0 : getThreshold(sender);
      if (matching < threshold)
      {
         abortMessage("runAs: have " + std::to_string(matching) + "/" + std::to_string(threshold) +
                      " producers required to authorize");
      }
   }

   void Producers::canAuthUserSys(AccountNumber user)
   {
      check(user == producerAccountStrong || user == producerAccountWeak,
            "Can only authorize predefined accounts");
   }

   bool Producers::isAuthSys(AccountNumber                             sender,
                             std::vector<AccountNumber>                authorizers,
                             std::optional<std::vector<AccountNumber>> authSet_opt)
   {
      auto authSet = authSet_opt ? std::move(*authSet_opt) : std::vector<AccountNumber>{};

      // Base case to prevent infinite recursion
      if (std::ranges::contains(authSet, sender))
         return false;

      authSet.push_back(sender);

      auto producers = ::getProducers()                          //
                       | std::views::transform(&Producer::name)  //
                       | std::ranges::to<std::vector>();

      auto threshold = producers.empty() ? 0 : getThreshold(sender);

      auto _ = recurse();
      return checkOverlapping(std::move(producers), std::move(authorizers), threshold,
                              &Actor<AuthInterface>::isAuthSys, std::move(authSet));
   }

   bool Producers::isRejectSys(AccountNumber                             sender,
                               std::vector<AccountNumber>                rejecters,
                               std::optional<std::vector<AccountNumber>> authSet_opt)
   {
      auto authSet = authSet_opt ? std::move(*authSet_opt) : std::vector<AccountNumber>{};

      // Base case to prevent infinite recursion
      if (std::ranges::contains(authSet, sender))
         return false;

      authSet.push_back(sender);

      auto producers = ::getProducers()                          //
                       | std::views::transform(&Producer::name)  //
                       | std::ranges::to<std::vector>();

      if (producers.empty())
         return false;

      auto threshold = antiThreshold(sender);

      auto _ = recurse();
      return checkOverlapping(std::move(producers), std::move(rejecters), threshold,
                              &Actor<AuthInterface>::isRejectSys, std::move(authSet));
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Producers)
