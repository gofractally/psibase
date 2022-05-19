#include "symbol_sys.hpp"

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;
using namespace UserContract::Errors;
using namespace system_contract;
using Quantity_t = typename Quantity::Quantity_t;

namespace
{
   template <class Target, class Source>
   Target canCast(Source v)
   {
      auto r = static_cast<Target>(v);
      return (static_cast<Source>(r) == v);
   }

   constexpr uint32_t secondsInDay{24 * 60 * 60};
}  // namespace

namespace PricingDefaults
{
   uint8_t increasePct;
   uint8_t decreasePct;

}  // namespace PricingDefaults

void SymbolSys::init()
{
   // Todo
   // Turn on manualDebit
   // Add initial configuration for SymbolLengthRecord and the PriceAdjustmentRecord
}

void SymbolSys::create(SID newSymbol, Quantity maxDebit)
{
   auto symbol = getSymbol(newSymbol);
   auto cost   = getPrice(newSymbol.str().length());

   check(symbol.ownerNft == 0, symbolAlreadyExists);

   // Debit the sender the cost of the symbol

   // mint owner nft
   // set owner nft on symbol record
   // credit nft to get_sender()

   db.open<SymbolTable_t>().put(symbol);

   emit().ui().symCreated(newSymbol, get_sender(), cost);
}

void SymbolSys::listSymbol(SID symbol, Quantity price)
{
   // NOP
}

void SymbolSys::buysymbol(SID symbol)
{
   // NOP
}

void SymbolSys::unlistSymbol(SID symbol)
{
   // NOP
}

SymbolRecord SymbolSys::getSymbol(SID symbol)
{
   auto symOpt = db.open<SymbolTable_t>().get_index<0>().get(symbol);

   if (symOpt.has_value())
   {
      return *symOpt;
   }
   else
   {
      check(SymbolRecord::isValidKey(symbol), invalidSymbol);

      return SymbolRecord{
          .symbolId{symbol},
      };
   }
}

Quantity SymbolSys::getPrice(size_t numChars)
{
   check(canCast<uint8_t>(numChars), invalidSymbol);
   auto key = static_cast<uint8_t>(numChars);

   auto symLengthTable = db.open<SymbolLengthTable_t>();
   auto symLengthIndex = symLengthTable.get_index<0>();
   auto symLengthOpt   = symLengthIndex.get(key);

   check(symLengthOpt.has_value(), invalidSymbol);
   auto symbolType = *symLengthOpt;

   auto updatePrice = [&]()
   {
      auto lastBlockTime = at<transaction_sys>().headBlockTime().unpack();
      if (lastBlockTime.seconds - symbolType.lastPriceUpdateTime.seconds > secondsInDay)
      {  // Decrease price if needed
         if (symbolType.createCounter < symbolType.targetCreatedPerDay)
         {
            const auto newPrice    = static_cast<Quantity_t>(symbolType.activePrice * 95 / 100);
            symbolType.activePrice = Quantity{newPrice};
         }

         // Price staying the same here is also an "update"
         symbolType.lastPriceUpdateTime = lastBlockTime;
         symbolType.createCounter       = 0;
      }

      if (symbolType.createCounter > symbolType.targetCreatedPerDay)
      {  // Increase price
         const auto newPrice    = static_cast<Quantity_t>(symbolType.activePrice * 105 / 100);
         symbolType.activePrice = Quantity{newPrice};
         symbolType.lastPriceUpdateTime = lastBlockTime;
         symbolType.createCounter       = 0;
      }
   };

   symLengthTable.put(symbolType);
   return symbolType.activePrice;
}

bool SymbolSys::exists(SID symbol)
{
   return false;
}

PSIBASE_DISPATCH(UserContract::SymbolSys)