#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/ProducerSys.hpp>

using namespace psibase;

namespace
{
   auto compare_claim = [](const Claim& lhs, const Claim& rhs)
   { return std::tie(lhs.service, lhs.rawData) < std::tie(rhs.service, rhs.rawData); };
}

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

   void ProducerSys::setConsensus(psibase::Consensus consensus)
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
      check(
          !status->nextConsensus || std::get<1>(*status->nextConsensus) == status->current.blockNum,
          "Consensus update pending");
      status->nextConsensus = std::tuple(std::move(consensus), status->current.blockNum);
      psibase::kvPut(StatusRow::db, StatusRow::key(), *status);
   }

   void ProducerSys::setProducers(std::vector<psibase::Producer> prods)
   {
      check(getSender() == getReceiver(), "sender must match service account");
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      check(!prods.empty(), "There must be at least one producer");
      checkAuthServices(prods);
      check(!!status, "Missing status row");
      check(
          !status->nextConsensus || std::get<1>(*status->nextConsensus) == status->current.blockNum,
          "Consensus update pending");
      status->nextConsensus = std::tuple(std::visit(
                                             [&](auto old)
                                             {
                                                old.producers = std::move(prods);
                                                return Consensus{std::move(old)};
                                             },
                                             status->consensus),
                                         status->current.blockNum);
      psibase::kvPut(StatusRow::db, StatusRow::key(), *status);
   }

   std::size_t getThreshold(const CftConsensus& bft)
   {
      return bft.producers.size() / 2 + 1;
   }

   std::size_t getThreshold(const BftConsensus& bft)
   {
      return bft.producers.size() * 2 / 3 + 1;
   }

   void ProducerSys::checkAuthSys(uint32_t                    flags,
                                  psibase::AccountNumber      requester,
                                  psibase::Action             action,
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
          status->consensus);
      std::sort(expectedClaims.begin(), expectedClaims.end(), compare_claim);
      std::sort(claims.begin(), claims.end(), compare_claim);
      std::vector<psibase::Claim> relevantClaims;
      std::set_intersection(claims.begin(), claims.end(), expectedClaims.begin(),
                            expectedClaims.end(), std::back_inserter(relevantClaims),
                            compare_claim);

      auto threshold =
          expectedClaims.empty()
              ? 0
              : std::visit([](const auto& c) { return getThreshold(c); }, status->consensus);
      if (relevantClaims.size() < threshold)
      {
         abortMessage("runAs: have " + std::to_string(relevantClaims.size()) + "/" +
                      std::to_string(threshold) + " producers required to authorize");
      }
   }

   void ProducerSys::canAuthUserSys(psibase::AccountNumber user)
   {
      // noop
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::ProducerSys)
