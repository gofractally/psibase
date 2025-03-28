#include <services/system/commonErrors.hpp>
#include <services/user/CoreFractal.hpp>
#include <services/user/Fractal.hpp>

using namespace UserService;
using namespace UserService::FractalNs;
using namespace psibase;

CoreFractal::CoreFractal(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get({});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void CoreFractal::init()
{
   to<Fractal>().registerType();
}

bool CoreFractal::isFracType()
{
   return true;
}

PSIBASE_DISPATCH(UserService::FractalNs::CoreFractal)
