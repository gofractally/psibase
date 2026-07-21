#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/SocketInfo.hpp>
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
      bool                     p2p = false;
      std::vector<std::string> hosts;
      std::vector<std::string> peers;
      PSIO_REFLECT(AdminOptionsRow, p2p, hosts, peers)
   };
   using AdminOptionsTable = psibase::Table<AdminOptionsRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(AdminOptionsTable)

   namespace Auth
   {
      struct Account
      {
         psibase::AccountNumber value;
      };
      PSIO_REFLECT_TYPENAME(Account)
      inline auto& clio_unwrap_packable(Account& obj)
      {
         return obj.value;
      }
      inline const auto& clio_unwrap_packable(const Account& obj)
      {
         return obj.value;
      }

      struct LocalUsername
      {
         std::string value;
      };
      PSIO_REFLECT_TYPENAME(LocalUsername)
      inline auto& clio_unwrap_packable(LocalUsername& obj)
      {
         return obj.value;
      }
      inline const auto& clio_unwrap_packable(const LocalUsername& obj)
      {
         return obj.value;
      }
      struct Unauthenticated
      {
         std::vector<std::string> challenges;
         PSIO_REFLECT(Unauthenticated, challenges)
      };
      using AuthResult = std::variant<Account, LocalUsername, Unauthenticated>;

      struct AuthInterface
      {
         /// This action will be called with the request, minus the body
         AuthResult checkAuth(psibase::HttpRequest request, std::optional<std::int32_t> socket);
      };
   }  // namespace Auth
   using Auth::AuthResult;

   /// Service for node administration
   struct XAdmin : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-admin"};
      using Subjective = psibase::SubjectiveTables<AdminAccountTable, CodeRefCountTable>;
      using Session    = psibase::SessionTables<AdminOptionsTable>;
      /// Returns true if the account or the remote end of socket is a node admin
      bool isAdmin(std::optional<psibase::AccountNumber>          account,
                   std::optional<std::int32_t>                    socket,
                   std::vector<std::optional<psibase::IPAddress>> forwardedFor);

      std::optional<psibase::HttpReply> checkAuth(const psibase::HttpRequest& req,
                                                  std::optional<std::int32_t> socket);
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);

      void startSession();
      /// This action can be called inside a subjective tx
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
