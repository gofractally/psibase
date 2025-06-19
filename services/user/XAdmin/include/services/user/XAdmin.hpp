#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <services/system/SetCode.hpp>

namespace UserService
{
   using SystemService::CodeRefCountRow;
   using SystemService::CodeRefCountTable;

   struct AdminAccountRow
   {
      psibase::AccountNumber account;
      PSIO_REFLECT(AdminAccountRow, account);
   };
   using AdminAccountTable = psibase::Table<AdminAccountRow, &AdminAccountRow::account>;
   PSIO_REFLECT_TYPENAME(AdminAccountTable)

   struct ContentRow
   {
      std::string                path            = {};
      std::string                contentType     = {};
      psibase::Checksum256       contentHash     = {};
      std::vector<char>          content         = {};
      std::optional<std::string> contentEncoding = std::nullopt;
      std::optional<std::string> csp             = std::nullopt;
      PSIO_REFLECT(ContentRow, path, contentType, contentHash, content, contentEncoding, csp)
   };
   using ContentTable = psibase::Table<ContentRow, &ContentRow::path>;
   PSIO_REFLECT_TYPENAME(ContentTable)

   struct XAdmin : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-admin"};
      using Subjective =
          psibase::SubjectiveTables<AdminAccountTable, CodeRefCountTable, ContentTable>;
      bool isAdmin(psibase::AccountNumber account);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest req);
   };
   PSIO_REFLECT(XAdmin, method(isAdmin, account))
   PSIBASE_REFLECT_TABLES(XAdmin, XAdmin::Subjective)
}  // namespace UserService
