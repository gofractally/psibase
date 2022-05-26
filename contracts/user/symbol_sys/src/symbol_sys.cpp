#include "symbol_sys.hpp"
#include "nft_sys.hpp"
#include "token_sys.hpp"

#include <iostream>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/common_errors.hpp>
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

SymbolSys::SymbolSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = db.open<InitTable_t>().getIndex<0>().get((uint8_t)0);
      check(initRecord.has_value(), uninitialized);
   }
}

void SymbolSys::init()
{
   auto initTable = db.open<InitTable_t>();
   auto init      = (initTable.getIndex<0>().get((uint8_t)0));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Configure manualDebit
   at<TokenSys>().setConfig("manualDebit"_m, true);
   at<NftSys>().setConfig("manualDebit"_m, true);

   // Configure default symbol length records to establish initial prices
   auto nextSym = [](SymbolLengthRecord& s)
   {
      s.symbolLength++;
      s.targetCreatedPerDay += 8;
      s.floorPrice  = s.floorPrice * 2 / 3;
      s.activePrice = s.activePrice * 2 / 3;
      return s;
   };
   auto symLengthTable = db.open<SymbolLengthTable_t>();
   auto s              = SymbolLengthRecord{.symbolLength        = 3,
                                            .targetCreatedPerDay = 24,
                                            .floorPrice{(Quantity_t)100e8},
                                            .activePrice{(Quantity_t)1000e8}};
   symLengthTable.put(s);           // Length 3
   symLengthTable.put(nextSym(s));  // Length 4
   symLengthTable.put(nextSym(s));  // Length 5
   symLengthTable.put(nextSym(s));  // Length 6
   symLengthTable.put(nextSym(s));  // Length 7

   // Add initial configuration for Price Adjustment Record
   auto              priceAdjustmentSingleton = db.open<PriceAdjustmentSingleton_t>();
   constexpr uint8_t increasePct              = 5;
   constexpr uint8_t decreasePct              = increasePct;
   priceAdjustmentSingleton.put(PriceAdjustmentRecord{0, increasePct, decreasePct});

   emit().ui().initialized();
}

void SymbolSys::create(SID newSymbol, Quantity maxDebit)
{
   auto sender = getSender();
   auto newSym = getSymbol(newSymbol);

   auto symString = newSymbol.str();

   auto symType = getSymbolType(symString.length());
   auto cost    = symType.activePrice;

   check(newSym.ownerNft == 0, symbolAlreadyExists);

   // Debit the sender the cost of the new symbol
   auto debitMemo = "This transfer created the new symbol: " + symString;
   at<TokenSys>().debit(TokenSys::sysToken, sender, cost, debitMemo);

   // Mint and offer ownership NFT
   newSym.ownerNft    = at<NftSys>().mint();
   auto nftCreditMemo = "This NFT conveys ownership of symbol: " + symString;
   at<NftSys>().credit(newSym.ownerNft, sender, nftCreditMemo);

   // Update symbol type statistics
   symType.createCounter++;
   symType.lastPriceUpdateTime = at<transaction_sys>().headBlockTime();

   db.open<SymbolTable_t>().put(newSym);
   db.open<SymbolLengthTable_t>().put(symType);

   emit().ui().symCreated(newSymbol, sender, cost);
}

void SymbolSys::listSymbol(SID symbol, Quantity price)
{
   auto seller       = getSender();
   auto symbolRecord = getSymbol(symbol);
   auto nft          = symbolRecord.ownerNft;
   auto nftContract  = at<NftSys>();

   check(price.value != 0, priceTooLow);
   check(nft != 0, symbolDNE);
   check(seller == nftContract.getNft(nft)->owner(), missingRequiredAuth);
   check(nftContract.getCredRecord(nft)->debitor() != account_sys::nullAccount,
         creditSymbolRequired);

   auto debitMemo = "Symbol " + symbol.str() + " is listed for sale.";

   nftContract.debit(nft, debitMemo);
   symbolRecord.saleDetails.salePrice = price;
   symbolRecord.saleDetails.seller    = seller;

   db.open<SymbolTable_t>().put(symbolRecord);

   emit().ui().symListed(symbol, seller, price);
}

void SymbolSys::buySymbol(SID symbol)
{
   auto buyer               = getSender();
   auto symbolRecord        = getSymbol(symbol);
   auto [salePrice, seller] = symbolRecord.saleDetails;
   auto tokenContract       = at<TokenSys>();

   check(symbolRecord.ownerNft != 0, symbolDNE);
   check(buyer != seller, buyerIsSeller);

   auto buyerMemo  = "Buying symbol " + symbol.str();
   auto sellerMemo = "Symbol " + symbol.str() + " sold";
   tokenContract.debit(TokenSys::sysToken, buyer, salePrice, buyerMemo);
   tokenContract.credit(TokenSys::sysToken, seller, salePrice, sellerMemo);
   at<NftSys>().credit(symbolRecord.ownerNft, buyer, buyerMemo);

   symbolRecord.saleDetails.seller    = AccountNumber{0};
   symbolRecord.saleDetails.salePrice = 0;

   db.open<SymbolTable_t>().put(symbolRecord);

   emit().ui().symSold(symbol, buyer, seller, salePrice);
}

void SymbolSys::unlistSymbol(SID symbol)
{
   auto seller       = getSender();
   auto symbolRecord = getSymbol(symbol);

   check(symbolRecord.ownerNft != 0, symbolDNE);
   check(seller == symbolRecord.saleDetails.seller, missingRequiredAuth);

   auto unlistMemo = "Unlisting symbol " + symbol.str();
   at<NftSys>().credit(symbolRecord.ownerNft, seller, unlistMemo);

   symbolRecord.saleDetails = SaleDetails{};

   db.open<SymbolTable_t>().put(symbolRecord);

   emit().ui().symUnlisted(symbol, seller);
}

SymbolRecord SymbolSys::getSymbol(SID symbol)
{
   check(symbol.value != 0, invalidSymbol);

   auto symOpt = db.open<SymbolTable_t>().getIndex<0>().get(symbol);

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
   return getSymbolType(numChars).activePrice;
}

SymbolLengthRecord SymbolSys::getSymbolType(size_t numChars)
{
   updatePrices();

   check(canCast<uint8_t>(numChars), invalidSymbol);
   auto key        = static_cast<uint8_t>(numChars);
   auto symbolType = db.open<SymbolLengthTable_t>().getIndex<0>().get(key);
   check(symbolType.has_value(), invalidSymbol);

   return *symbolType;
}

void SymbolSys::updatePrices()
{
   auto symLengthTable = db.open<SymbolLengthTable_t>();
   auto symLengthIndex = symLengthTable.getIndex<0>();

   auto priceAdjustmentIdx = db.open<PriceAdjustmentSingleton_t>().getIndex<0>();
   auto priceAdjustmentRec = *priceAdjustmentIdx.get(uint8_t{0});
   auto dec                = static_cast<uint64_t>((uint8_t)100 - priceAdjustmentRec.decreasePct);
   auto inc                = static_cast<uint64_t>((uint8_t)100 + priceAdjustmentRec.increasePct);

   auto lastBlockTime = at<transaction_sys>().headBlockTime().unpack();
   for (auto symbolType : symLengthIndex)
   {
      if (lastBlockTime.seconds - symbolType.lastPriceUpdateTime.seconds > secondsInDay)
      {  // Decrease price if needed
         if (symbolType.createCounter < symbolType.targetCreatedPerDay)
         {
            auto newPrice          = static_cast<Quantity_t>(symbolType.activePrice * dec / 100);
            newPrice               = std::max(newPrice, symbolType.floorPrice.value);
            symbolType.activePrice = Quantity{newPrice};
         }

         // Price staying the same here is also an "update"
         symbolType.lastPriceUpdateTime = lastBlockTime;
         symbolType.createCounter       = 0;
      }

      if (symbolType.createCounter > symbolType.targetCreatedPerDay)
      {  // Increase price
         const auto newPrice    = static_cast<Quantity_t>(symbolType.activePrice * inc / 100);
         symbolType.activePrice = Quantity{newPrice};
         symbolType.lastPriceUpdateTime = lastBlockTime;
         symbolType.createCounter       = 0;
      }

      symLengthTable.put(symbolType);
   }
}

bool SymbolSys::exists(SID symbol)
{
   auto symOpt = db.open<SymbolTable_t>().getIndex<0>().get(symbol);
   return symOpt.has_value();
}

PSIBASE_DISPATCH(UserContract::SymbolSys)