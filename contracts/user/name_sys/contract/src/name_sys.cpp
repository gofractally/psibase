#include "name_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace name_sys;
using namespace psibase;

void name_contract::create(psibase::account_num account, psibase::account_num ram_payer)
{
   // NOP
}

PSIBASE_DISPATCH(name_sys::name_contract)