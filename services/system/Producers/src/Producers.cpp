#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/Producers.hpp>

using namespace psibase;

namespace
{
   auto compare_claim = [](const Claim& lhs, const Claim& rhs)
   { return std::tie(lhs.service, lhs.rawData) < std::tie(rhs.service, rhs.rawData); };
}  // namespace

namespace SystemService
{
   // Verifies that all the auth services have the correct flags set
   static void checkAuthServices(const std::vector<psibase::Producer>& producers)
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
      for (AccountNumber account : accounts)
      {
         auto code = psibase::kvGet<CodeRow>(CodeRow::db, codeKey(account));
         check(!!code, "Unknown service account: " + account.str());
         check(code->flags & CodeRow::isAuthService,
               "Service account " + account.str() + " cannot be used for block production");
      }
   }

   void Producers::setConsensus(psibase::ConsensusData consensus)
   {
      check(getSender() == getReceiver(), "sender must match service account");
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      std::visit(
          [](const auto& c)
          {
             check(!c.producers.empty(), "There must be at least one producer");
             checkAuthServices(c.producers);
          },
          consensus);
      check(!!status, "Missing status row");
      check(!status->consensus.next || status->consensus.next->blockNum == status->current.blockNum,
            "Consensus update pending");
      status->consensus.next = {{std::move(consensus), status->consensus.current.services},
                                status->current.blockNum};
      psibase::kvPut(StatusRow::db, StatusRow::key(), *status);
   }

   void Producers::setProducers(std::vector<psibase::Producer> prods)
   {
      check(getSender() == getReceiver(), "sender must match service account");
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      check(!prods.empty(), "There must be at least one producer");
      checkAuthServices(prods);
      check(!!status, "Missing status row");
      check(!status->consensus.next || status->consensus.next->blockNum == status->current.blockNum,
            "Consensus update pending");
      status->consensus.next = {{std::visit(
                                     [&](auto old)
                                     {
                                        old.producers = std::move(prods);
                                        return ConsensusData{std::move(old)};
                                     },
                                     status->consensus.current.data),
                                 status->consensus.current.services},
                                status->current.blockNum};
      psibase::kvPut(StatusRow::db, StatusRow::key(), *status);
   }

   std::size_t getThreshold(const CftConsensus& cft, AccountNumber account)
   {
      if (account == Producers::producerAccountWeak)
         return 1;
      else
         return cft.producers.size() / 2 + 1;
   }

   std::size_t getThreshold(const BftConsensus& bft, AccountNumber account)
   {
      if (account == Producers::producerAccountWeak)
         return (bft.producers.size() + 2) / 3;
      else
         return bft.producers.size() * 2 / 3 + 1;
   }

   void Producers::checkAuthSys(uint32_t                    flags,
                                psibase::AccountNumber      requester,
                                psibase::AccountNumber      sender,
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

      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());

      std::vector<psibase::Claim> expectedClaims;
      std::visit(
          [&](auto& c)
          {
             for (const auto& [name, auth] : c.producers)
             {
                expectedClaims.push_back(auth);
             }
          },
          status->consensus.current.data);
      std::sort(claims.begin(), claims.end(), compare_claim);
      auto matching = std::ranges::count_if(
          expectedClaims, [&](const auto& claim)
          { return claim == Claim{} || std::ranges::binary_search(claims, claim, compare_claim); });

      auto threshold = expectedClaims.empty()
                           ? 0
                           : std::visit([&](const auto& c) { return getThreshold(c, sender); },
                                        status->consensus.current.data);
      if (matching < threshold)
      {
         abortMessage("runAs: have " + std::to_string(matching) + "/" + std::to_string(threshold) +
                      " producers required to authorize");
      }
   }

   void Producers::canAuthUserSys(psibase::AccountNumber user)
   {
      check(user == producerAccountStrong || user == producerAccountWeak,
            "Can only authorize predefined accounts");
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Producers)
