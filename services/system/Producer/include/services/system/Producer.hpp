#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/TransactionSys.hpp>

namespace SystemService
{
   // This service manages the active producers.
   // It must have native write permission
   class Producer : public psibase::Service<Producer>
   {
     public:
      static constexpr auto service      = psibase::AccountNumber("producer");
      static constexpr auto serviceFlags = psibase::CodeRow::allowWriteNative;

      /// `prods-weak` and `prods-strong` are accounts that represent authorization
      /// by the current block producers.  `prods-weak` is a quorum that is sufficient
      /// to guarantee inclusion of at least one honest producer.  i.e, it is one more
      /// than the maximum number of dishonest producers that the current consensus
      /// settings can tolerate. This is useful for actions that cannot conflict or
      /// for which conflicts are resolved by an off-chain process.
      ///
      /// `prods-strong` provides the additional guarantee that if two actions are
      /// both authorized by `prods-strong`, there is at least one honest producer
      /// that authorized both actions. It should generally be preferred over `prods-weak`.
      ///
      /// |        | cft       | bft        |
      /// |--------|-----------|------------|
      /// | weak   | 1         | ⌈n/3⌉      |
      /// | strong | ⌊n/2⌋ + 1 | ⌊2n/3⌋ + 1 |
      static constexpr auto producerAccountWeak   = psibase::AccountNumber("prods-weak");
      static constexpr auto producerAccountStrong = psibase::AccountNumber("prods-strong");

      void setConsensus(psibase::Consensus consensus);
      void setProducers(std::vector<psibase::Producer> prods);

      // Allows this service to be used as an auth service for `prods-weak` and `prods-strong`.
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);
      void canAuthUserSys(psibase::AccountNumber user);
   };
   PSIO_REFLECT(Producer,
                method(setConsensus, consensus),
                method(setProducers, producers),
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user))
}  // namespace SystemService
