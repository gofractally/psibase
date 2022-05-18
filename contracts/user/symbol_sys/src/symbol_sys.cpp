#include "symbol_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;

void SymbolSys::create(SID newSymbol, Quantity maxDebit)
{
   // NOP
}

void SymbolSys::buysymbol(SID symbol)
{
   // NOP
}

void SymbolSys::listSymbol(SID symbol, Quantity price)
{
   // NOP
}

void SymbolSys::unlistSymbol(SID symbol)
{
   // NOP
}

SymbolRecord SymbolSys::getSymbol(SID symbol)
{
   // NOP
   return {};
}

Quantity SymbolSys::getPrice(uint8_t numChars)
{
   return Quantity{1'000e8};
}

bool SymbolSys::exists(SID symbol)
{
   return false;
}

PSIBASE_DISPATCH(UserContract::SymbolSys)