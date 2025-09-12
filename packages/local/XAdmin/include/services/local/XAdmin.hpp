#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <services/system/SetCode.hpp>

namespace LocalService
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

   /// Service for node administration
   struct XAdmin : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-admin"};
      using Subjective = psibase::SubjectiveTables<AdminAccountTable, CodeRefCountTable>;
      /// Returns true if the account is a node admin
      bool isAdmin(psibase::AccountNumber account);

      std::optional<psibase::HttpReply> checkAuth(const psibase::HttpRequest& req,
                                                  std::optional<std::int32_t> socket);
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XAdmin,
                method(isAdmin, account),
                method(checkAuth, req, socket),
                method(serveSys, req, socket))
   PSIBASE_REFLECT_TABLES(XAdmin, XAdmin::Subjective)
}  // namespace LocalService
