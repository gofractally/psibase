#include "symbol_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;

SID SymbolSys::purchase(Ticker newSymbol, Quantity maxCost)
{
   // NOP
   return 0;
}

SymbolRecord SymbolSys::getSymbol(SID symbolId)
{
   // NOP
   return {};
}

Quantity SymbolSys::getPrice(uint8_t numChars)
{
   return Quantity{1000};
}

PSIBASE_DISPATCH(UserContract::SymbolSys)