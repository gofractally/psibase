#include "NameSys.hpp"

#include <psibase/dispatch.hpp>

using namespace NameSys;
using namespace psibase;

void name_contract::create(psibase::AccountNumber account, psibase::AccountNumber ram_payer)
{
   // NOP
}

PSIBASE_DISPATCH(NameSys::name_contract)