#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/local/XAdmin.hpp>

namespace LocalService
{

   struct PasswordRow
   {
      std::string                username;
      std::string                hash;
      std::optional<std::string> password;
      PSIO_REFLECT(PasswordRow, username, hash, password)
   };
   using PasswordTable = psibase::Table<PasswordRow, &PasswordRow::username>;
   PSIO_REFLECT_TYPENAME(PasswordTable)

   struct XBasic : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-basic"};
      using Session                 = psibase::SessionTables<PasswordTable>;
      void       startSession();
      AuthResult checkAuth(const psibase::HttpRequest& req, std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XBasic, method(startSession), method(checkAuth, request, socket))
   PSIBASE_REFLECT_TABLES(XBasic, XBasic::Session)
}  // namespace LocalService
