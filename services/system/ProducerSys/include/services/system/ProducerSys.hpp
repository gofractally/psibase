#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/TransactionSys.hpp>

namespace SystemService
{
   // This service manages the active producers.
   // It must have native write permission
   class ProducerSys : public psibase::Service<ProducerSys>
   {
     public:
      static constexpr auto service      = psibase::AccountNumber("producer-sys");
      static constexpr auto serviceFlags = psibase::CodeRow::allowWriteNative;

      void setConsensus(psibase::Consensus consensus);
      void setProducers(std::vector<psibase::Producer> prods);

      // Allows this service to be used as an auth service.
      // Passes if more than 2/3 of the active producers have signed the transaction
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);
      void checkUserSys(psibase::AccountNumber user);
   };
   PSIO_REFLECT(ProducerSys,
                method(setConsensus, consensus),
                method(setProducers, producers),
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(checkUserSys, user))
}  // namespace SystemService
