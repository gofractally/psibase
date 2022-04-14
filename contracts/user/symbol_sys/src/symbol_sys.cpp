#include "symbol_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace symbol_sys;
using namespace psibase;

void symbol_contract::create(psibase::AccountNumber owner, int64_t max_supply)
{
   // NOP
}

PSIBASE_DISPATCH(symbol_sys::symbol_contract)