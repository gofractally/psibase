#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <vector>

namespace UserService
{
   struct UiDep
   {
      std::string            name;
      psibase::AccountNumber service;
      PSIO_REFLECT(UiDep, name, service)
   };
   struct UiDeps
   {
      psibase::AccountNumber service;
      std::vector<UiDep>     deps;
      PSIO_REFLECT(UiDeps, service, deps)
   };
   using UiDepsTable = psibase::Table<UiDeps, &UiDeps::service>;
   PSIO_REFLECT_TYPENAME(UiDepsTable)

   struct DynLd : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"dyn-ld"};
      using Tables                  = psibase::ServiceTables<UiDepsTable>;
      void linkUi(std::vector<UiDep> deps);
   };
   PSIO_REFLECT(DynLd, method(linkUi, deps))
   PSIBASE_REFLECT_TABLES(DynLd, DynLd::Tables)
}  // namespace UserService
