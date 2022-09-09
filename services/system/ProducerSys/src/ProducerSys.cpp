#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/ProducerSys.hpp>

using namespace psibase;

namespace
{
   auto compare_claim = [](const Claim& lhs, const Claim& rhs)
   { return std::tie(lhs.contract, lhs.rawData) < std::tie(rhs.contract, rhs.rawData); };
}

namespace SystemService
{

   void ProducerSys::setProducers(std::vector<psibase::ProducerConfigRow> prods)
   {
      check(getSender() == getReceiver(), "sender must match contract account");
      constexpr auto db = ProducerConfigRow::db;
      // Remove existing producer rows
      TableIndex<ProducerConfigRow, decltype(prods[0].key())> idx(db, std::vector<char>{}, false);
      for (auto row : idx.subindex(producerConfigTable))
      {
         kvRemove(db, row.key());
      }

      for (const auto& row : prods)
      {
         kvPut(db, row.key(), row);
      }
   }

   void ProducerSys::checkAuthSys(uint32_t                    flags,
                                  psibase::AccountNumber      requester,
                                  psibase::Action             action,
                                  std::vector<ContractMethod> allowedActions,
                                  std::vector<psibase::Claim> claims)
   {
      Table<ProducerConfigRow, &ProducerConfigRow::key> t(ProducerConfigRow::db,
                                                          std::vector<char>{});
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

      //
      std::vector<psibase::Claim> expectedClaims;
      for (auto row : t.getIndex<0>().subindex(producerConfigTable))
      {
         expectedClaims.push_back(row.producerAuth);
      }
      std::sort(expectedClaims.begin(), expectedClaims.end(), compare_claim);
      std::sort(claims.begin(), claims.end(), compare_claim);
      std::vector<psibase::Claim> relevantClaims;
      std::set_intersection(claims.begin(), claims.end(), expectedClaims.begin(),
                            expectedClaims.end(), std::back_inserter(relevantClaims),
                            compare_claim);
      auto threshold = expectedClaims.empty() ? 0 : expectedClaims.size() * 2 / 3 + 1;
      if (relevantClaims.size() < threshold)
      {
         abortMessage("runAs: have " + std::to_string(relevantClaims.size()) + "/" +
                      std::to_string(threshold) + " producers required to authorize");
      }
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::ProducerSys)
