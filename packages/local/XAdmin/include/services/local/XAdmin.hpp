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

   struct AdminOptionsRow
   {
      bool p2p = false;
      PSIO_REFLECT(AdminOptionsRow, p2p)
   };
   using AdminOptionsTable = psibase::Table<AdminOptionsRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(AdminOptionsTable)

   /// Service for node administration
   struct XAdmin : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-admin"};
      using Subjective = psibase::SubjectiveTables<AdminAccountTable, CodeRefCountTable>;
      using Session    = psibase::SessionTables<AdminOptionsTable>;
      /// Returns true if the account or the remote end of socket is a node admin
      bool isAdmin(std::optional<psibase::AccountNumber> account,
                   std::optional<std::int32_t>           socket);

      std::optional<psibase::HttpReply> checkAuth(const psibase::HttpRequest& req,
                                                  std::optional<std::int32_t> socket);
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);

      void            startSession();
      AdminOptionsRow options();
   };
   PSIO_REFLECT(XAdmin,
                method(isAdmin, account, socket),
                method(checkAuth, req, socket),
                method(serveSys, req, socket),
                method(startSession),
                method(options))
   PSIBASE_REFLECT_TABLES(XAdmin, XAdmin::Subjective, XAdmin::Session)
}  // namespace LocalService
