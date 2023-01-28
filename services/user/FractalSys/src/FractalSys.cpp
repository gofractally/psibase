#include <services/system/commonErrors.hpp>
#include <services/user/FractalSys.hpp>

using namespace UserService;
using namespace UserService::Fractal;
using namespace psibase;

FractalSys::FractalSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void FractalSys::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), UserService::Errors::alreadyInit);
   initTable.put(InitializedRecord{});
}

PSIBASE_DISPATCH(UserService::Fractal::FractalSys)
