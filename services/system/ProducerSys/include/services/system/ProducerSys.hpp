#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/TransactionSys.hpp>

namespace system_contract
{
   // This contract manages the active producers.
   // It must have native write permission
   class ProducerSys : public psibase::Contract<ProducerSys>
   {
     public:
      void setProducers(std::vector<psibase::ProducerConfigRow> prods);

      // Allows this contract to be used as an auth contract.
      // Passes if more than 2/3 of the active producers have signed the transaction
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ContractMethod> allowedActions,
                        std::vector<psibase::Claim> claims);
   };
   PSIO_REFLECT(ProducerSys,
                method(setProducers, producers),
                method(checkAuthSys, flags, requester, action, allowedActions, claims))
}  // namespace system_contract
