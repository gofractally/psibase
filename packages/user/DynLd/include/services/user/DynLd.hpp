#pragma once

#include <algorithm>
#include <format>
#include <map>
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

   inline DynDeps mergeDynDepGroups(DynDepGroups groups)
   {
      DynDeps result{groups.service};
      for (auto& [_, group] : groups.groups)
      {
         result.deps.insert(result.deps.end(), std::move_iterator(group.begin()),
                            std::move_iterator(group.end()));
      }

      std::ranges::sort(result.deps, {}, &DynDep::name);
      if (auto conflict = std::ranges::adjacent_find(
              result.deps,
              [](const DynDep& lhs, const DynDep& rhs)
              { return lhs.name == rhs.name && lhs.service != rhs.service; });
          conflict != result.deps.end())
      {
         psibase::abortMessage(std::format("Conflicting imports for {} ({} != {})",
                                           conflict->name, conflict->service.str(),
                                           (conflict + 1)->service.str()));
      }
      auto extra = std::ranges::unique(result.deps, {}, &DynDep::name);
      result.deps.erase(extra.begin(), extra.end());
      return result;
   }

   template <class GroupsTable, class DepsTable>
   inline void linkDynDepGroup(GroupsTable&         groupsTable,
                               DepsTable&           depsTable,
                               psibase::AccountNumber service,
                               std::string          group,
                               std::vector<DynDep>  deps)
   {
      auto groups = groupsTable.get(service).value_or(DynDepGroups{service});
      groups.groups[group] = std::move(deps);
      groupsTable.put(groups);
      depsTable.put(mergeDynDepGroups(std::move(groups)));
   }

   template <class GroupsTable, class DepsTable>
   inline void unlinkDynDepGroup(GroupsTable&           groupsTable,
                                 DepsTable&             depsTable,
                                 psibase::AccountNumber service,
                                 std::string              group)
   {
      if (auto row = groupsTable.get(service))
      {
         if (row->groups.erase(group) != 0)
         {
            if (row->groups.empty())
            {
               groupsTable.remove(*row);
               depsTable.erase(service);
            }
            else
            {
               groupsTable.put(*row);
               depsTable.put(mergeDynDepGroups(std::move(*row)));
            }
         }
      }
   }

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
