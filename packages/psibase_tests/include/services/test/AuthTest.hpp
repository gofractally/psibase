#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>

namespace TestService
{
   struct AuthRow
   {
      psibase::AccountNumber              account;
      std::vector<psibase::AccountNumber> deps;
      std::uint32_t                       threshold;
      PSIO_REFLECT(AuthRow, account, deps, threshold)
   };
   using AuthTable = psibase::Table<AuthRow, &AuthRow::account>;
   PSIO_REFLECT_TYPENAME(AuthTable)

   struct AuthTest : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"auth-test"};

      using Tables = psibase::ServiceTables<AuthTable>;

      void newAccount(psibase::AccountNumber              account,
                      std::vector<psibase::AccountNumber> deps,
                      std::uint32_t                       threshold);
      void canAuthUserSys(psibase::AccountNumber account);
      void setAuth(psibase::AccountNumber              account,
                   std::vector<psibase::AccountNumber> deps,
                   std::uint32_t                       threshold);
      auto getDlgsSys(psibase::AccountNumber account) -> std::vector<psibase::AccountNumber>;
      bool isAuthSys(psibase::AccountNumber account, std::vector<psibase::AccountNumber> approved);
      bool isRejectSys(psibase::AccountNumber              account,
                       std::vector<psibase::AccountNumber> rejected);
   };
   PSIO_REFLECT(AuthTest,
                method(newAccount, account, deps, threshold),
                method(canAuthUserSys, account),
                method(setAuth, account, deps, threshold),
                method(getDlgsSys, account),
                method(isAuthSys, account, approved),
                method(isRejectSys, account, rejected))
   PSIBASE_REFLECT_TABLES(AuthTest, AuthTest::Tables)
}  // namespace TestService
