#pragma once
#include <psibase/Table.hpp>

namespace UserService
{
   namespace Fractal
   {

      struct ServiceEventRecord
      {
         psibase::SingletonKey key;
         uint64_t              eventHead;
      };
      PSIO_REFLECT(ServiceEventRecord, key, eventHead);

      using ServiceEventTable = psibase::Table<ServiceEventRecord, &ServiceEventRecord::key>;

      // Implemented by fractal types in order to be compatible with this parent service
      struct FractalInterface
      {
         bool isFracType();
      };
      PSIO_REFLECT(FractalInterface, method(isFracType));

      struct FractalTypeRecord
      {
         psibase::AccountNumber service;
         // TODO - metadata could be stored here that gives fractal creators a better
         //  understanding of what this fractal type is for.
      };
      PSIO_REFLECT(FractalTypeRecord, service);
      using FractalTypeTable = psibase::Table<FractalTypeRecord, &FractalTypeRecord::service>;

      struct FractalRecord
      {
         psibase::AccountNumber name;
         psibase::AccountNumber type;
         std::string            prettyName;
         psibase::AccountNumber founder;

         uint64_t eventHead;

         auto secondary() const { return std::tie(type, name); }
      };
      PSIO_REFLECT(FractalRecord, name, type, prettyName, founder, eventHead);
      using FractalTable =
          psibase::Table<FractalRecord, &FractalRecord::name, &FractalRecord::secondary>;

      struct MembershipKey
      {
         psibase::AccountNumber account;
         psibase::AccountNumber fractal;

         auto operator<=>(const MembershipKey&) const = default;
      };
      PSIO_REFLECT(MembershipKey, account, fractal);

      struct MembershipRecord
      {
         MembershipKey          key;
         psibase::AccountNumber inviter;
         uint64_t               rewardShares;

         auto operator<=>(const MembershipRecord&) const = default;
      };
      PSIO_REFLECT(MembershipRecord, key, inviter, rewardShares);
      using MemberTable = psibase::Table<MembershipRecord, &MembershipRecord::key>;

      struct InviteRecord
      {
         psibase::PublicKey     key;
         psibase::AccountNumber creator;
         psibase::AccountNumber fractal;
         psibase::AccountNumber recipient;

         auto secondary() const { return std::tie(recipient, key); }
      };
      PSIO_REFLECT(InviteRecord, key, creator, fractal, recipient);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::key, &InviteRecord::secondary>;

      // Identity on fractal-sys, does not necessarily mean you joined any fractal
      // TODO: rename to ProfileRecord
      struct IdentityRecord
      {
         psibase::AccountNumber name;

         uint64_t eventHead;
         // Todo - metadata / profile
      };
      PSIO_REFLECT(IdentityRecord, name, eventHead);
      using IdentityTable = psibase::Table<IdentityRecord, &IdentityRecord::name>;

   }  // namespace Fractal
}  // namespace UserService
