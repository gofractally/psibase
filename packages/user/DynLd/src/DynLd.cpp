#include <services/user/DynLd.hpp>

#include <algorithm>
#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserService;

namespace
{
   DynDeps mergeGroups(DynDepGroups&& groups)
   {
      DynDeps result{groups.service};
      for (const auto& [_, group] : groups.groups)
      {
         result.deps.insert(result.deps.end(), std::move_iterator(group.begin()),
                            std::move_iterator(group.end()));
      }

      std::ranges::sort(result.deps, {}, &DynDep::name);
      // Check for consistency
      (void)std::ranges::adjacent_find(
          result.deps,
          [](const auto& lhs, const auto& rhs)
          {
             if (lhs.name == rhs.name && lhs.service != rhs.service)
                abortMessage(std::format("Conflicting imports for {} ({} != {})", lhs.name,
                                         lhs.service.str(), rhs.service.str()));
             return false;
          });
      auto extra = std::ranges::unique(result.deps, {}, &DynDep::name);
      result.deps.erase(extra.begin(), extra.end());
      return result;
   }
}  // namespace

void DynLd::link(std::string group, std::vector<DynDep> deps)
{
   auto sender          = getSender();
   auto groupsTable     = open<DynDepGroupsTable>();
   auto groups          = groupsTable.get(sender).value_or(DynDepGroups{sender});
   groups.groups[group] = std::move(deps);
   groupsTable.put(groups);
   open<DynDepsTable>().put(mergeGroups(std::move(groups)));
}

void DynLd::unlink(std::string group)
{
   auto sender      = getSender();
   auto groupsTable = open<DynDepGroupsTable>();
   if (auto row = groupsTable.get(sender))
   {
      if (row->groups.erase(group) != 0)
      {
         auto table = open<DynDepsTable>();
         if (row->groups.empty())
         {
            groupsTable.remove(*row);
            table.erase(sender);
         }
         else
         {
            groupsTable.put(*row);
            table.put(mergeGroups(std::move(*row)));
         }
      }
   }
}

PSIBASE_DISPATCH(DynLd)
