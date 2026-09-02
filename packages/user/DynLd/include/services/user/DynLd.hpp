#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <vector>

namespace UserService
{
   struct DynDep
   {
      std::string            name;
      psibase::AccountNumber service;
      PSIO_REFLECT(DynDep, name, service)
   };

   struct DynDepGroups
   {
      psibase::AccountNumber                     service;
      std::map<std::string, std::vector<DynDep>> groups;
      PSIO_REFLECT(DynDepGroups, service, groups)
   };
   using DynDepGroupsTable = psibase::Table<DynDepGroups, &DynDepGroups::service>;
   PSIO_REFLECT_TYPENAME(DynDepGroupsTable)

   struct DynDeps
   {
      psibase::AccountNumber service;
      std::vector<DynDep>    deps;
      PSIO_REFLECT(DynDeps, service, deps)
   };
   using DynDepsTable = psibase::Table<DynDeps, &DynDeps::service>;
   PSIO_REFLECT_TYPENAME(DynDepsTable)

   struct DynLd : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"dyn-ld"};
      using Tables                  = psibase::ServiceTables<DynDepsTable, DynDepGroupsTable>;
      // The group name can be used to replace or remove a set of dependencies
      // All dependencies for all groups for a service must be consistent
      void link(std::string group, std::vector<DynDep> deps);
      void unlink(std::string group);
   };
   PSIO_REFLECT(DynLd, method(link, group, deps), method(unlink, group))
   PSIBASE_REFLECT_TABLES(DynLd, DynLd::Tables)
}  // namespace UserService
