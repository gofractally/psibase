#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/table.hpp>

namespace UserContract
{
   using NID = uint32_t;

   struct AdRecord
   {
      psibase::AccountNumber user;
      bool                   autodebit;

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const AdRecord&, const AdRecord&) = default;
   };
   PSIO_REFLECT(AdRecord, user, autodebit);

   using AdTable_t = psibase::table<AdRecord, &AdRecord::user>;
   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber creditedTo;

      static bool isValidKey(const NID& id) { return id != 0; }

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const NftRecord&, const NftRecord&) = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);

   using NftTable_t = psibase::table<NftRecord, &NftRecord::id>;
}  // namespace UserContract