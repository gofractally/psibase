#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/Transact.hpp>

namespace SystemService
{
   // This service manages the active producers.
   // It must have native write permission
   class Producers : public psibase::Service
   {
     public:
      static constexpr auto service      = psibase::AccountNumber("producers");
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

      void setConsensus(psibase::ConsensusData consensus);
      void setProducers(std::vector<psibase::Producer> prods);

      std::vector<psibase::AccountNumber> getProducers();

      uint32_t getThreshold(psibase::AccountNumber account);
      uint32_t antiThreshold(psibase::AccountNumber account);

      // Allows this service to be used as an auth service for `prods-weak` and `prods-strong`.
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);
      void canAuthUserSys(psibase::AccountNumber user);

      /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being authorized.
      /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
      /// * `authSet`: The set of accounts that are already being checked for authorization. If
      ///              the sender is already in this set, then the function should return false.
      ///
      /// Returns:
      /// * `true`: If the total authorizations from `authorizers` or their auth services meets sender's threshold
      /// * `false`: If not returning true, or on recursive checks for the same sender
      bool isAuthSys(psibase::AccountNumber                             sender,
                     std::vector<psibase::AccountNumber>                authorizers,
                     std::optional<std::vector<psibase::AccountNumber>> authSet);

      /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being rejected.
      /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
      /// * `authSet`: The set of accounts that are already being checked for authorization. If
      ///              the sender is already in this set, then the function should return false.
      ///
      /// Returns:
      /// * `true`: If the total authorizations from `rejecters` or their auth services meets sender's threshold
      /// * `false`: If not returning true, or on recursive checks for the same sender
      bool isRejectSys(psibase::AccountNumber                             sender,
                       std::vector<psibase::AccountNumber>                rejecters,
                       std::optional<std::vector<psibase::AccountNumber>> authSet);
   };
   PSIO_REFLECT(Producers,
                method(setConsensus, consensus),
                method(setProducers, producers),
                method(getProducers),
                method(getThreshold, account),
                method(antiThreshold, account),
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers, authSet),
                method(isRejectSys, sender, rejecters, authSet)
                //
   )

}  // namespace SystemService
