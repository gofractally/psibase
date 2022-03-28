#include "tokens_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace tokens_sys;
using namespace psibase;

void tokens_contract::open(psibase::account_num account,
                           tid                  token_id,
                           psibase::account_num storage_payer)
{
   // NOP
}

PSIBASE_DISPATCH(tokens_sys::tokens_contract)