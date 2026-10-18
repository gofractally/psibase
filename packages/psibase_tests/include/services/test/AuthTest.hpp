#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>

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

   struct AuthMethodRow
   {
      AuthRow                auth;
      psibase::ServiceMethod method;
      using Key =
          psibase::CompositeKey<psibase::NestedKey<&AuthMethodRow::auth, &AuthRow::account>{},
                                &AuthMethodRow::method>;
      PSIO_REFLECT(AuthMethodRow, auth, method)
   };
   using AuthMethodTable = psibase::Table<AuthMethodRow, AuthMethodRow::Key{}>;
   PSIO_REFLECT_TYPENAME(AuthMethodTable)

   struct AuthTest : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"auth-test"};

      using Tables = psibase::ServiceTables<AuthTable, AuthMethodTable>;

      void newAccount(psibase::AccountNumber              account,
                      std::vector<psibase::AccountNumber> deps,
                      std::uint32_t                       threshold);
      void canAuthUserSys(psibase::AccountNumber account);
      void setAuth(psibase::AccountNumber                account,
                   std::vector<psibase::AccountNumber>   deps,
                   std::uint32_t                         threshold,
                   std::optional<psibase::ServiceMethod> action);
      auto getDlgsSys(psibase::AccountNumber account, std::optional<psibase::ServiceMethod> action)
          -> std::vector<psibase::AccountNumber>;
      bool isAuthSys(psibase::AccountNumber                account,
                     std::vector<psibase::AccountNumber>   approved,
                     std::optional<psibase::ServiceMethod> action);
      bool isRejectSys(psibase::AccountNumber                account,
                       std::vector<psibase::AccountNumber>   rejected,
                       std::optional<psibase::ServiceMethod> action);
   };
   PSIO_REFLECT(AuthTest,
                method(newAccount, account, deps, threshold),
                method(canAuthUserSys, account),
                method(setAuth, account, deps, threshold, action),
                method(getDlgsSys, account, action),
                method(isAuthSys, account, approved, action),
                method(isRejectSys, account, rejected, action))
   PSIBASE_REFLECT_TABLES(AuthTest, AuthTest::Tables)
}  // namespace TestService
