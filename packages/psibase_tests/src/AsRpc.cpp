#include <services/test/AsRpc.hpp>

#include <psibase/dispatch.hpp>

using namespace TestService;
using namespace psibase;

void AsRpc::asRpc(Action action)
{
   call(action, CallFlags::runModeRpc);
}

PSIBASE_DISPATCH(AsRpc)
