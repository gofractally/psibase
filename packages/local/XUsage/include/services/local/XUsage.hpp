#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/usage.hpp>

namespace LocalService
{
   // A quota: how much one identity, or every identity of a kind that has
   // no quota of its own, may use per usage window.
   //
   // PHASE 1: STORED, NOT ENFORCED. The operator can set and read quotas;
   // nothing compares them with what was used. Enforcement belongs in
   // native code at psibase::UsageMeter::enforceQuota
   // (gofractally/psibase#2270).
   struct UsageQuotaRow
   {
      // static_cast<psibase::UsageKind>(kind)
      std::uint8_t kind = 0;
      // The identity's id; empty for the default of the kind
      std::string id;
      // The most of each counter in one usage window. Zero: no limit.
      psibase::UsageCounters perWindow;
      PSIO_REFLECT(UsageQuotaRow, kind, attr(id, utf8), perWindow)
   };
   using UsageQuotaTable =
       psibase::Table<UsageQuotaRow,
                      psibase::CompositeKey<&UsageQuotaRow::kind, &UsageQuotaRow::id>{}>;
   PSIO_REFLECT_TYPENAME(UsageQuotaTable)

   /// Reports what each connection identity used of this node
   ///
   /// Native code measures and stores (psibase::UsageMeter, the native
   /// UsageTable); this service only reads it. Everything here is local to
   /// the node.
   ///
   /// - `GET /me`: the caller's own usage. The caller is the account named
   ///   by its login token, otherwise its address. No parameter selects
   ///   another identity.
   /// - `GET /report`, `GET /identity`, `GET /quotas`, `POST /quota`: the
   ///   operator's view; they require what x-admin requires of its own
   ///   endpoints.
   struct XUsage : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-usage"};
      using Subjective              = psibase::SubjectiveTables<UsageQuotaTable>;
      auto serveSys(const psibase::HttpRequest& request, std::optional<std::int32_t> socket)
          -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(XUsage, method(serveSys, request, socket))
   PSIBASE_REFLECT_TABLES(XUsage, XUsage::Subjective)
}  // namespace LocalService
