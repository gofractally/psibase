#include <catch2/catch_all.hpp>
#include <catch2/catch_test_macros.hpp>
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
   const Memo memo{"memo"};
   const TID  sysToken{Tokens::sysToken};

   using Quantity_t = Quantity::Quantity_t;

   namespace SymbolPricing
   {
      const auto initialPrice          = static_cast<Quantity_t>(1'000);
      const int  increaseRatePct       = 5;
      const int  decreaseRatePct       = 5;
      const int  targetNrSymbolsPerDay = 24;
   }  // namespace SymbolPricing

   auto q = [](Quantity_t amt, Precision p) { return Quantity{amt * std::pow(10, p.value)}; };

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
      auto sysToken  = sysIssuer.create(Precision{4}, 1'000'000'000e4).returnVal();
      t.from(Symbol::service).to<Symbol>().init(sysToken);

      auto precision = sysIssuer.getToken(sysToken).returnVal().precision;

      sysIssuer.setTokenConf(sysToken, Tokens::untransferable, false);
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

         CHECK(a.create(symbolId).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with uppercase letters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"aBc"};
         CHECK(a.create(symbolId).failed(symbolLengthNotSupported));
      }
      THEN("Alice cannot create a symbol with fewer than 3 characters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"ab"};
         CHECK(a.create(symbolId).failed(symbolLengthNotSupported));
      }
      THEN("Alice cannot create a symbol with greater than 7 characters")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"abcdefgh"};
         CHECK(a.create(symbolId).failed(symbolLengthNotSupported));
      }
      THEN("Alice can create a symbol")
      {
         auto credit = alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         CHECK(credit.succeeded());

         CHECK(quantity.value == a.getPrice(3).returnVal().value);

         auto symbolId = SID{"abc"};
         auto create   = a.create(symbolId);
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
            CHECK(a.create(symbolId).failed(symbolAlreadyExists));
         }
      }
      WHEN("Alice creates a symbol")
      {
         alice.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
         auto symbolId = SID{"abc"};
         a.create(symbolId);
         auto nftId = a.getSymbol(symbolId).returnVal().ownerNft;
         alice.to<Nft>().debit(nftId, memo);

         THEN("Bob cannot create the same symbol")
         {
            auto credit = bob.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"abc"});
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Alice cannot create the same symbol")
         {
            auto create = a.create(SID{"abc"});
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Bob can buy a different symbol")
         {
            auto credit = bob.to<Tokens>().credit(sysToken, Symbol::service, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"bcd"});
            CHECK(create.succeeded());
         }
      }
   }
}
// derp

SCENARIO("Measuring price increases")
{
   GIVEN("Alice has a lot of money")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto a     = alice.to<Symbol>();

      auto sysIssuer = t.from(Symbol::service).to<Tokens>();
      auto sysToken  = sysIssuer.create(Precision{4}, 1'000'000'000e4).returnVal();
      REQUIRE(t.from(Symbol::service).to<Symbol>().init(sysToken).succeeded());

      auto precision = sysIssuer.getToken(sysToken).returnVal().precision;

      auto aliceBalance = q(1'000'000, precision);

      sysIssuer.setTokenConf(sysToken, Tokens::untransferable, false);
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

         auto create = a.create(SID{"abc"});
         CHECK(create.succeeded());

         AND_THEN("Buying another symbol is the same price")
         {
            CHECK(a.getPrice(3).returnVal() == q(SymbolPricing::initialPrice, precision));
            a.create(SID{"bcd"});
            auto balance =
                alice.to<Tokens>().getSharedBal(sysToken, alice, Nft::service).returnVal().value;
            CHECK(balance == 0);
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
      auto sysIssuer = t.from(Symbol::service).to<Tokens>();
      auto sysToken  = sysIssuer.create(Precision{4}, 1'000'000'000e4).returnVal();
      REQUIRE(t.from(Symbol::service).to<Symbol>().init(sysToken).succeeded());
      auto precision    = sysIssuer.getToken(sysToken).returnVal().precision;
      auto aliceBalance = q(1'000'000, precision);

      sysIssuer.setTokenConf(sysToken, Tokens::untransferable, false);
      sysIssuer.mint(sysToken, aliceBalance, memo);
      REQUIRE(sysIssuer.credit(sysToken, alice, aliceBalance, memo).succeeded());

      // Create the symbol and claim the owner NFT
      auto symbolCost = a.getPrice(3).returnVal();
      alice.to<Tokens>().credit(sysToken, Symbol::service, symbolCost, memo);
      auto symbolId = SID{"abc"};
      REQUIRE(a.create(symbolId).succeeded());
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
