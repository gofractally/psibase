#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <string>
#include <vector>

namespace LocalService
{
   struct ContentRow
   {
      psibase::AccountNumber     account         = {};
      std::string                path            = {};
      std::string                contentType     = {};
      psibase::Checksum256       contentHash     = {};
      std::vector<char>          content         = {};
      std::optional<std::string> contentEncoding = std::nullopt;
      std::optional<std::string> csp             = std::nullopt;
      PSIO_REFLECT(ContentRow,
                   account,
                   path,
                   contentType,
                   contentHash,
                   content,
                   contentEncoding,
                   csp)
   };
   using ContentTable = psibase::Table<ContentRow, &ContentRow::path>;
   PSIO_REFLECT_TYPENAME(ContentTable)

   struct XSites : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-sites"};

      using Subjective = psibase::SubjectiveTables<ContentTable>;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XSites, method(serveSys, req, socket))
   PSIBASE_REFLECT_TABLES(XSites, XSites::Subjective)
}  // namespace LocalService
