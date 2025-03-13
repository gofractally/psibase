#pragma once
#include <psibase/Table.hpp>
#include <services/system/Spki.hpp>

namespace UserService
{
   namespace FractalNs
   {
      using PublicKey = SystemService::AuthSig::SubjectPublicKeyInfo;

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
      PSIO_REFLECT_TYPENAME(FractalTypeTable)

      struct FractalRecord
      {
         psibase::AccountNumber account;
         psibase::AccountNumber type;
         psibase::AccountNumber founder;
         psibase::TimePointUSec creationTime;

         std::string displayName;
         std::string description;
         std::string languageCode;

         using ByType = psibase::CompositeKey<&FractalRecord::type, &FractalRecord::account>;
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
          psibase::Table<FractalRecord, &FractalRecord::account, FractalRecord::ByType{}>;
      PSIO_REFLECT_TYPENAME(FractalTable)

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

         using ByAccount = psibase::NestedKey<
             &MembershipRecord::key,
             psibase::CompositeKey<&MembershipKey::account, &MembershipKey::fractal>{}>;

         auto operator<=>(const MembershipRecord&) const = default;
      };
      PSIO_REFLECT(MembershipRecord, key, inviter, rewardShares);
      using MemberTable =
          psibase::Table<MembershipRecord, &MembershipRecord::key, MembershipRecord::ByAccount{}>;
      PSIO_REFLECT_TYPENAME(MemberTable)

      struct InviteRecord
      {
         PublicKey              key;
         psibase::AccountNumber creator;
         psibase::AccountNumber fractal;
         psibase::AccountNumber recipient;

         using Secondary = psibase::CompositeKey<&InviteRecord::recipient, &InviteRecord::key>;
      };
      PSIO_REFLECT(InviteRecord, key, creator, fractal, recipient);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::key, InviteRecord::Secondary{}>;
      PSIO_REFLECT_TYPENAME(InviteTable)

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
      PSIO_REFLECT_TYPENAME(IdentityTable)

   }  // namespace FractalNs
}  // namespace UserService
