#include <services/user/DynLd.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserService;

void DynLd::linkUi(std::vector<UiDep> deps)
{
   open<UiDepsTable>().put({getSender(), std::move(deps)});
}

PSIBASE_DISPATCH(DynLd)
