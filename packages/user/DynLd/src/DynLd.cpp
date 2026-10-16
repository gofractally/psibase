#include <services/user/DynLd.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserService;

void DynLd::link(std::string group, std::vector<DynDep> deps)
{
   auto groupsTable = open<DynDepGroupsTable>();
   auto depsTable   = open<DynDepsTable>();
   linkDynDepGroup(groupsTable, depsTable, getSender(), std::move(group), std::move(deps));
}

void DynLd::unlink(std::string group)
{
   auto groupsTable = open<DynDepGroupsTable>();
   auto depsTable   = open<DynDepsTable>();
   unlinkDynDepGroup(groupsTable, depsTable, getSender(), std::move(group));
}

PSIBASE_DISPATCH(DynLd)
