#include <catch2/catch_all.hpp>
#include <cmath>
#include <psibase/DefaultTestChain.hpp>
#include <psio/fracpack.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/Nft.hpp"
#include "services/user/Symbol.hpp"
#include "services/user/Tokens.hpp"

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;

namespace
{
   const Memo    memo{"memo"};
   const TID     sysToken{Tokens::sysToken};
   const uint8_t untradeable = 0;

   using Quantity_t = Quantity::Quantity_t;

   namespace SymbolPricing
   {
      const auto initialPrice          = static_cast<Quantity_t>(1'000);
      const int  increaseRatePct       = 5;
      const int  decreaseRatePct       = 5;
      const int  targetNrSymbolsPerDay = 24;
   }  // namespace SymbolPricing

   auto q = [](Quantity_t amt, uint8_t p) { return Quantity{amt * std::pow(10, p)}; };

}  // namespace

SCENARIO("Buying a symbol")
{
   GIVEN("An standard setup chain")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto a     = alice.to<Symbol>();
      auto bob   = t.from(t.addAccount("bob"_a));
      auto b     = bob.to<Symbol>();

      auto sysIssuer = t.from(Symbol::service).to<Tokens>();
      auto precision = sysIssuer.getToken(sysToken).returnVal().precision;

      sysIssuer.setTokenConf(sysToken, untradeable, false);
      auto issuance = sysIssuer.mint(sysToken, q(20'000, precision), memo);
      CHECK(issuance.succeeded());

      sysIssuer.credit(sysToken, alice, q(10'000, precision), memo);
      auto lastCredit = sysIssuer.credit(sysToken, bob, q(10'000, precision), memo);
      CHECK(lastCredit.succeeded());

      const Quantity quantity{q(SymbolPricing::initialPrice, precision)};

      THEN("Alice cannot create a symbol with numbers")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = AccountNumber{"ab1"};
         CHECK(AccountNumber{"ab1"}.value != 0);

         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with uppercase letters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"aBc"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with fewer than 3 characters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"ab"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with greater than 7 characters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"abcdefgh"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice can create a symbol")
      {
         auto credit = alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         CHECK(credit.succeeded());

         CHECK(quantity == a.getPrice(3).returnVal());

         auto symbolId = SID{"abc"};
         auto create   = a.create(symbolId, quantity);
         CHECK(create.succeeded());

         auto getSymbol = a.getSymbol(symbolId);
         CHECK(getSymbol.succeeded());

         AND_THEN("Alice owns the symbol")
         {
            auto ownerNftId = getSymbol.returnVal().ownerNft;
            auto getNft     = alice.to<Nft>().getNft(ownerNftId);
            CHECK(getNft.succeeded());

            auto nft = getNft.returnVal();
            CHECK(nft.owner == alice.id);

            AND_THEN("The new symbolId is not 0")
            {  //
               CHECK(symbolId != SID{0});
            }
         }

         AND_THEN("Alice-Symbol shared balance is updated accordingly")
         {
            auto getSharedBalance = alice.to<Tokens>().getSharedBal(sysToken, alice, Nft::service);
            CHECK(getSharedBalance.succeeded());
            CHECK(getSharedBalance.returnVal().value == 0);
         }

         AND_THEN("Alice cannot create the same symbol again")
         {
            alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
            CHECK(a.create(symbolId, quantity).failed(symbolAlreadyExists));
         }
      }
      WHEN("Alice creates a symbol")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"abc"};
         a.create(symbolId, quantity);
         auto nftId = a.getSymbol(symbolId).returnVal().ownerNft;
         alice.to<Nft>().debit(nftId, memo);

         THEN("Bob cannot create the same symbol")
         {
            auto credit = bob.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Alice cannot create the same symbol")
         {
            auto create = a.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Bob can buy a different symbol")
         {
            auto credit = bob.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"bcd"}, quantity);
            CHECK(create.succeeded());
         }
      }
   }
}

SCENARIO("Measuring price increases")
{
   GIVEN("Alice has a lot of money")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto a     = alice.to<Symbol>();

      auto sysIssuer = t.from(Symbol::service).to<Tokens>();
      auto precision = sysIssuer.getToken(sysToken).returnVal().precision;

      auto aliceBalance = q(1'000'000, precision);

      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, aliceBalance, memo);
      sysIssuer.credit(sysToken, alice, aliceBalance, memo);

      const Quantity quantity{q(SymbolPricing::initialPrice, precision)};

      std::vector<SID> tickers{
          // 25 tickers
          SID{"abc"}, SID{"abg"}, SID{"abk"}, SID{"abo"}, SID{"abs"}, SID{"abv"}, SID{"aby"},
          SID{"abd"}, SID{"abh"}, SID{"abl"}, SID{"abp"}, SID{"abt"}, SID{"abw"}, SID{"abz"},
          SID{"abe"}, SID{"abi"}, SID{"abm"}, SID{"abq"}, SID{"abu"}, SID{"abx"}, SID{"acc"},
          SID{"abf"}, SID{"abj"}, SID{"abn"}, SID{"abr"},
      };

      auto secondsInDay   = (1'000 * 60 * 60 * 24);
      auto incrementPrice = [](Quantity_t starting)
      {
         int updateVal = 100 + SymbolPricing::increaseRatePct;
         return static_cast<Quantity_t>(starting * updateVal / 100);  //
      };

      auto decrementPrice = [](Quantity_t starting)
      {
         int updateVal = 100 - SymbolPricing::decreaseRatePct;
         return static_cast<Quantity_t>(starting * updateVal / 100);  //
      };

      THEN("Alice can buy the first symbol for initialPrice tokens")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, 2 * quantity.value, memo);

         CHECK(a.getPrice(3).returnVal() == q(SymbolPricing::initialPrice, precision));

         auto create = a.create(SID{"abc"}, quantity);
         CHECK(create.succeeded());

         AND_THEN("Buying another symbol is the same price")
         {
            CHECK(a.getPrice(3).returnVal() == q(SymbolPricing::initialPrice, precision));
            a.create(SID{"bcd"}, quantity);
            auto balance =
                alice.to<Tokens>().getSharedBal(sysToken, alice, Nft::service).returnVal().value;
            CHECK(balance == 0);
         }
      }
      THEN("The price remains stable if sold symbols per day is targetNrSymbolsPerDay")
      {
         t.startBlock(secondsInDay + 10'000);  // Start a new day (price will drop once)
         auto cost{decrementPrice(q(SymbolPricing::initialPrice, precision))};

         auto symbolDetails = a.getSymbolType(3).returnVal();
         CHECK(symbolDetails.createCounter == 0);
         CHECK(symbolDetails.activePrice.value == cost);

         // If per day target is updated, unit test needs to be updated
         CHECK(SymbolPricing::targetNrSymbolsPerDay == symbolDetails.targetCreatedPerDay);

         alice.to<Tokens>().credit(sysToken, Symbol::service, 24 * cost, memo);

         bool      costConstant = true;
         const int numSymbols   = 24;
         for (int i = 0; i < numSymbols && costConstant; ++i)
         {
            a.create(tickers[i], cost);
            costConstant = (a.getPrice(3).returnVal() == cost);
         }
         CHECK(costConstant);
         CHECK(numSymbols == a.getSymbolType(3).returnVal().createCounter);

         AND_THEN("The price for the first create that exceeds the desired rate is higher")
         {
            alice.to<Tokens>().credit(sysToken, Symbol::service, cost, memo);

            // Create the 25th symbol within 24 hours, causing the price to increase
            CHECK(a.getSymbolType(3).returnVal().createCounter == 24);
            auto create = a.create(tickers[24], cost);
            CHECK(create.succeeded());
            CHECK(a.getSymbolType(3).returnVal().createCounter == 0);

            auto nextPrice = incrementPrice(cost);
            CHECK(a.getPrice(3).returnVal() == nextPrice);
         }
      }
      THEN("The price decreases if less than x are sold over 24 hours")
      {
         CHECK(a.getPrice(3).returnVal() == q(SymbolPricing::initialPrice, precision));
         t.startBlock(secondsInDay + 10'000);  // 10 seconds more than a full day has passed

         auto nextPrice = decrementPrice(q(SymbolPricing::initialPrice, precision));
         CHECK(a.getPrice(3).returnVal() == nextPrice);

         AND_THEN("The price decreases even more if too few are sold over 48 hours")
         {
            t.startBlock(secondsInDay + 10'000);  // More than two full days has passed

            nextPrice = decrementPrice(nextPrice);
            CHECK(a.getPrice(3).returnVal() == nextPrice);
         }
      }
   }
}

SCENARIO("Using symbol ownership NFT")
{
   GIVEN("Alice has created a symbol")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));
      auto a     = alice.to<Symbol>();

      // Mint token used for purchasing symbols
      auto sysIssuer    = t.from(Symbol::service).to<Tokens>();
      auto precision    = sysIssuer.getToken(sysToken).returnVal().precision;
      auto aliceBalance = q(1'000'000, precision);

      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, q(20'000, precision), memo);
      sysIssuer.credit(sysToken, alice, aliceBalance, memo);

      // Create the symbol and claim the owner NFT
      auto symbolCost = a.getPrice(3).returnVal();
      alice.to<Tokens>().credit(sysToken, Symbol::service, symbolCost, memo);
      auto symbolId = SID{"abc"};
      a.create(symbolId, symbolCost);
      auto symbolRecord = a.getSymbol(symbolId).returnVal();
      auto nftId        = symbolRecord.ownerNft;
      alice.to<Nft>().debit(nftId, memo);

      WHEN("Alice transfers her symbol to Bob")
      {
         alice.to<Nft>().credit(nftId, bob, memo);
         bob.to<Nft>().debit(nftId, memo);
         // No additional testing needed to confirm transfers work, as it's piggybacking on NFT transferability

         THEN("The symbol record is identical")
         {
            auto symbolRecord2 = a.getSymbol(symbolId).returnVal();
            CHECK(symbolRecord2 == symbolRecord);
         }
      }
      WHEN("Alice burns her symbol owner NFT")
      {
         alice.to<Nft>().burn(nftId);

         THEN("The symbol record is identical")
         {
            auto symbolRecord2 = a.getSymbol(symbolId).returnVal();
            CHECK(symbolRecord2 == symbolRecord);
         }
      }
   }
}

SCENARIO("Buying and selling symbols")
{
   GIVEN("A chain with a system token")
   {
      DefaultTestChain t;

      // Add a couple accounts
      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));

      // Fund Alice and Bob with the system token
      auto sysIssuer   = t.from(Symbol::service).to<Tokens>();
      auto precision   = sysIssuer.getToken(sysToken).returnVal().precision;
      auto userBalance = q(1'000'000, precision);

      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, 2 * userBalance.value, memo);
      sysIssuer.credit(sysToken, alice, userBalance, memo);
      sysIssuer.credit(sysToken, bob, userBalance, memo);

      // Create system symbol
      auto sysSymbol  = SID{"sys"};
      auto numChars   = sysSymbol.str().size();
      auto symbolCost = alice.to<Symbol>().getPrice(numChars).returnVal();
      alice.to<Tokens>().credit(sysToken, Symbol::service, symbolCost, memo);
      alice.to<Symbol>().create(sysSymbol, symbolCost);

      // Map system symbol to system token
      auto sysSymbolNft = alice.to<Symbol>().getSymbol(sysSymbol).returnVal().ownerNft;
      alice.to<Nft>().credit(sysSymbolNft, Tokens::service, memo);
      alice.to<Tokens>().map_symbol(sysToken, sysSymbol);

      WHEN("Alice creates a symbol")
      {
         auto symbol = SID{"abc"};
         alice.to<Tokens>().credit(sysToken, Symbol::service, symbolCost, memo);
         alice.to<Symbol>().create(symbol, symbolCost);

         auto symbolNft        = alice.to<Symbol>().getSymbol(symbol).returnVal().ownerNft;
         auto initialNftRecord = alice.to<Nft>().getNft(symbolNft).returnVal();

         THEN("Alice can list it for sale")
         {
            alice.to<Nft>().credit(symbolNft, Symbol::service, memo);
            CHECK(alice.to<Symbol>().listSymbol(symbol, q(1'000, precision)).succeeded());

            AND_THEN("Alice no longer owns the symbol")
            {
               auto newNftRecord = alice.to<Nft>().getNft(symbolNft).returnVal();
               CHECK(newNftRecord != initialNftRecord);

               // Make sure only owner changed
               newNftRecord.owner = alice.id;
               CHECK((newNftRecord.id == initialNftRecord.id &&          //
                      newNftRecord.issuer == initialNftRecord.issuer &&  //
                      newNftRecord.owner == initialNftRecord.owner));
               //CHECK(newNftRecord == initialNftRecord);
               // Todo - Use simple comparison if/when eventHeadId is removed from the Nft Record.
            }
         }
         THEN("Alice cannot list it below the floor price")
         {
            auto listPrice = q(0, precision);
            CHECK(alice.to<Symbol>().listSymbol(symbol, listPrice).failed(priceTooLow));
         }
         WHEN("The symbol is mapped to a token")
         {
            auto newToken = alice.to<Tokens>().create(8, userBalance).returnVal();
            alice.to<Tokens>().mint(newToken, userBalance, memo);
            auto newTokenId = alice.to<Tokens>().getToken(newToken).returnVal().id;

            alice.to<Tokens>().map_symbol(newTokenId, symbol);
            THEN("The symbol cannot be sold")
            {
               CHECK(alice.to<Symbol>()
                         .listSymbol(symbol, q(1'000, precision))
                         .failed(creditSymbolRequired));
            }
         }
         WHEN("The symbol is for sale")
         {
            auto listPrice = q(1'000, precision);
            alice.to<Nft>().credit(symbolNft, Symbol::service, memo);
            alice.to<Symbol>().listSymbol(symbol, listPrice);

            THEN("Alice cannot buy the symbol")
            {
               CHECK(alice.to<Symbol>().buySymbol(symbol).failed(buyerIsSeller));
            }

            THEN("Bob cannot unlist the symbol")
            {
               CHECK(bob.to<Symbol>().unlistSymbol(symbol).failed(missingRequiredAuth));
            }
            THEN("Alice can unlist the symbol")
            {
               CHECK(alice.to<Symbol>().unlistSymbol(symbol).succeeded());
            }
            THEN("Bob cannot buy the symbol for less than the list price")
            {
               bob.to<Tokens>().credit(sysToken, Symbol::service, listPrice.value / 2, memo);
               auto buySymbol = bob.to<Symbol>().buySymbol(symbol);
               CHECK(buySymbol.failed(insufficientBalance));
            }
            THEN("Bob can buy the symbol")
            {
               bob.to<Tokens>().credit(sysToken, Symbol::service, listPrice, memo);
               CHECK(bob.to<Symbol>().buySymbol(symbol).succeeded());
            }
            AND_WHEN("Bob buys the symbol")
            {
               bob.to<Tokens>().credit(sysToken, Symbol::service, listPrice, memo);
               bob.to<Symbol>().buySymbol(symbol);

               THEN("Bob owns the symbol")
               {
                  auto newNftRecord = bob.to<Nft>().getNft(symbolNft).returnVal();
                  CHECK(newNftRecord.owner == bob.id);

                  newNftRecord.owner = initialNftRecord.owner;
                  CHECK((newNftRecord.id == initialNftRecord.id &&          //
                         newNftRecord.issuer == initialNftRecord.issuer &&  //
                         newNftRecord.owner == initialNftRecord.owner));
                  //CHECK(newNftRecord == initialNftRecord);
                  // Todo - Use simple comparison if/when eventHeadId is removed from the Nft Record.
               }
               THEN("The symbol is no longer for sale")
               {
                  auto symbolRecord = alice.to<Symbol>().getSymbol(symbol).returnVal();
                  CHECK(symbolRecord.saleDetails.salePrice == q(0, precision));
               }
               THEN("Bob can reslist the symbol")
               {
                  bob.to<Nft>().credit(symbolNft, Symbol::service, memo);
                  bob.to<Symbol>().listSymbol(symbol, listPrice);
               }
            }
         }
      }
   }
}
