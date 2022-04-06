#include "name_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace name_sys;
using namespace psibase;

void name_contract::create(psibase::AccountNumber account, psibase::AccountNumber ram_payer)
{
   // NOP
}

PSIBASE_DISPATCH(name_sys::name_contract)