#include <services/system/commonErrors.hpp>
#include <services/user/CoreFractalSys.hpp>
#include <services/user/FractalSys.hpp>

using namespace UserService;
using namespace UserService::Fractal;
using namespace psibase;

CoreFractalSys::CoreFractalSys(psio::shared_view_ptr<psibase::Action> action)
{
MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void CoreFractalSys::init()
{
   to<FractalSys>().registerType();
}

bool CoreFractalSys::isFracType()
{
   return true;
}

PSIBASE_DISPATCH(UserService::Fractal::CoreFractalSys)
