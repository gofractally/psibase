#pragma once
#include <psibase/Table.hpp>
#include <services/system/Spki.hpp>

namespace UserService
{
   namespace FractalNs
   {
      using PublicKey = SystemService::AuthSig::SubjectPublicKeyInfo;

      struct InviteEventType
      {
         static constexpr std::string_view created  = "created";
         static constexpr std::string_view claimed  = "claimed";
         static constexpr std::string_view accepted = "accepted";
         static constexpr std::string_view rejected = "rejected";
      };

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
         psibase::AccountNumber account;
         psibase::AccountNumber type;
         psibase::AccountNumber founder;
         psibase::TimePointUSec creationTime;

         std::string displayName;
         std::string description;
         std::string languageCode;

         auto byType() const { return std::tie(type, account); }
      };
      PSIO_REFLECT(FractalRecord,
                   account,
                   type,
                   founder,
                   creationTime,
                   displayName,
                   description,
                   languageCode);
      using FractalTable =
          psibase::Table<FractalRecord, &FractalRecord::account, &FractalRecord::byType>;

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

         auto byAccount() const { return std::tie(key.account, key.fractal); }

         auto operator<=>(const MembershipRecord&) const = default;
      };
      PSIO_REFLECT(MembershipRecord, key, inviter, rewardShares);
      using MemberTable =
          psibase::Table<MembershipRecord, &MembershipRecord::key, &MembershipRecord::byAccount>;

      struct InviteRecord
      {
         uint32_t               inviteId;
         PublicKey              key;
         psibase::AccountNumber creator;
         psibase::AccountNumber fractal;
         psibase::AccountNumber recipient;

         auto secondary() const { return std::tie(recipient, key); }
      };
      PSIO_REFLECT(InviteRecord, inviteId, key, creator, fractal, recipient);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::inviteId, &InviteRecord::secondary>;

      // Identity in the fractal service, does not necessarily mean you joined a fractal
      // TODO: rename to ProfileRecord
      struct IdentityRecord
      {
         psibase::AccountNumber name;

         std::string displayName;

         // Todo - metadata / profile
      };
      PSIO_REFLECT(IdentityRecord, name, displayName);
      using IdentityTable = psibase::Table<IdentityRecord, &IdentityRecord::name>;

   }  // namespace FractalNs
}  // namespace UserService
