#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <psibase/DefaultTestChain.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/NftSys.hpp"
#include "services/user/SymbolSys.hpp"
#include "services/user/TokenSys.hpp"

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;

namespace
{
   const std::vector<std::pair<AccountNumber, const char*>> neededServices = {
       {TokenSys::service, "TokenSys.wasm"},
       {NftSys::service, "NftSys.wasm"},
       {SymbolSys::service, "SymbolSys.wasm"}};

   const String   memo{"memo"};
   const TID      sysToken{TokenSys::sysToken};
   constexpr auto untradeable = "untradeable"_m;

   using Quantity_t = Quantity::Quantity_t;

   namespace SymbolPricing
   {
      const auto initialPrice          = static_cast<Quantity_t>(1'000e8);
      const int  increaseRatePct       = 5;
      const int  decreaseRatePct       = 5;
      const int  targetNrSymbolsPerDay = 24;
   }  // namespace SymbolPricing

}  // namespace

SCENARIO("Buying a symbol")
{
   GIVEN("An standard setup chain")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<SymbolSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<SymbolSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto sysIssuer = t.from(SymbolSys::service).to<TokenSys>();
      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, 20'000e8, memo);
      sysIssuer.credit(sysToken, alice, 10'000e8, memo);
      sysIssuer.credit(sysToken, bob, 10'000e8, memo);

      t.startBlock();

      THEN("Alice cannot create a symbol with numbers")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
         auto symbolId = AccountNumber{"ab1"};
         CHECK(AccountNumber{"ab1"}.value != 0);

         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with uppercase letters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
         auto symbolId = SID{"aBc"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with fewer than 3 characters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
         auto symbolId = SID{"ab"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with greater than 7 characters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
         auto symbolId = SID{"abcdefgh"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice can create a symbol")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         auto credit = alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
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
            auto getNft     = alice.to<NftSys>().getNft(ownerNftId);
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
            auto getSharedBalance =
                alice.to<TokenSys>().getSharedBal(sysToken, alice, NftSys::service);
            CHECK(getSharedBalance.succeeded());
            CHECK(getSharedBalance.returnVal().balance == 0);
         }

         AND_THEN("Alice cannot create the same symbol again")
         {
            t.startBlock();
            alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
            CHECK(a.create(symbolId, quantity).failed(symbolAlreadyExists));
         }
      }
      WHEN("Alice creates a symbol")
      {
         auto quantity{SymbolPricing::initialPrice};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
         auto symbolId = SID{"abc"};
         a.create(symbolId, quantity);
         auto nftId = a.getSymbol(symbolId).returnVal().ownerNft;
         alice.to<NftSys>().debit(nftId, memo);

         THEN("Bob cannot create the same symbol")
         {
            auto credit = bob.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Alice cannot create the same symbol")
         {
            t.startBlock();
            auto create = a.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Bob can buy a different symbol")
         {
            auto credit = bob.to<TokenSys>().credit(sysToken, SymbolSys::service, quantity, memo);
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
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<SymbolSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto aliceBalance = 1'000'000e8;
      auto sysIssuer    = t.from(SymbolSys::service).to<TokenSys>();
      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, aliceBalance, memo);
      sysIssuer.credit(sysToken, alice, aliceBalance, memo);

      t.startBlock();

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
         auto quantity{SymbolPricing::initialPrice};

         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, 2 * quantity, memo);

         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);

         auto create = a.create(SID{"abc"}, quantity);
         CHECK(create.succeeded());

         AND_THEN("Buying another symbol is the same price")
         {
            t.startBlock();
            CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
            a.create(SID{"bcd"}, quantity);
            auto balance = alice.to<TokenSys>()
                               .getSharedBal(sysToken, alice, NftSys::service)
                               .returnVal()
                               .balance;
            CHECK(balance == 0);
         }
      }
      THEN("The price remains stable if sold symbols per day is targetNrSymbolsPerDay")
      {
         t.startBlock(secondsInDay + 10'000);  // Start a new day (price will drop once)
         auto cost{decrementPrice(SymbolPricing::initialPrice)};

         auto symbolDetails = a.getSymbolType(3).returnVal();
         CHECK(symbolDetails.createCounter == 0);
         CHECK(symbolDetails.activePrice.value == cost);

         // If per day target is updated, unit test needs to be updated
         CHECK(SymbolPricing::targetNrSymbolsPerDay == symbolDetails.targetCreatedPerDay);

         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, 24 * cost, memo);

         bool      costConstant = true;
         const int numSymbols   = 24;
         for (int i = 0; i < numSymbols && costConstant; ++i)
         {
            a.create(tickers[i], cost);
            t.startBlock();

            costConstant = (a.getPrice(3).returnVal() == cost);
         }
         CHECK(costConstant);
         CHECK(numSymbols == a.getSymbolType(3).returnVal().createCounter);

         AND_THEN("The price for the first create that exceeds the desired rate is higher")
         {
            t.startBlock();
            alice.to<TokenSys>().credit(sysToken, SymbolSys::service, cost, memo);

            // Create the 25th symbol within 24 hours, causing the price to increase
            CHECK(a.getSymbolType(3).returnVal().createCounter == 24);
            auto create = a.create(tickers[24], cost);
            CHECK(create.succeeded());
            t.startBlock();

            CHECK(a.getSymbolType(3).returnVal().createCounter == 0);

            auto nextPrice = incrementPrice(cost);
            CHECK(a.getPrice(3).returnVal() == nextPrice);
         }
      }
      THEN("The price decreases if less than x are sold over 24 hours")
      {
         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         t.startBlock(secondsInDay + 10'000);  // 10 seconds more than a full day has passed

         auto nextPrice = decrementPrice(SymbolPricing::initialPrice);
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
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto bob   = t.from(t.add_account("bob"_a));
      auto a     = alice.to<SymbolSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      // Mint token used for purchasing symbols
      auto aliceBalance = 1'000'000e8;
      auto sysIssuer    = t.from(SymbolSys::service).to<TokenSys>();
      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, 20'000e8, memo);
      sysIssuer.credit(sysToken, alice, aliceBalance, memo);

      // Create the symbol and claim the owner NFT
      auto symbolCost = a.getPrice(3).returnVal();
      alice.to<TokenSys>().credit(sysToken, SymbolSys::service, symbolCost, memo);
      auto symbolId = SID{"abc"};
      a.create(symbolId, symbolCost);
      auto symbolRecord = a.getSymbol(symbolId).returnVal();
      auto nftId        = symbolRecord.ownerNft;
      alice.to<NftSys>().debit(nftId, memo);

      t.startBlock();

      WHEN("Alice transfers her symbol to Bob")
      {
         alice.to<NftSys>().credit(nftId, bob, memo);
         bob.to<NftSys>().debit(nftId, memo);
         // No additional testing needed to confirm transfers work, as it's piggybacking on NFT transferability

         THEN("The symbol record is identical")
         {
            auto symbolRecord2 = a.getSymbol(symbolId).returnVal();
            CHECK(symbolRecord2 == symbolRecord);
         }
      }
      WHEN("Alice burns her symbol owner NFT")
      {
         alice.to<NftSys>().burn(nftId);

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
      DefaultTestChain t(neededServices);

      // Add a couple accounts
      auto alice = t.from(t.add_account("alice"_a));
      auto bob   = t.from(t.add_account("bob"_a));

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      // Fund Alice and Bob with the system token
      auto userBalance = 1'000'000e8;
      auto sysIssuer   = t.from(SymbolSys::service).to<TokenSys>();
      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, 2 * userBalance, memo);
      sysIssuer.credit(sysToken, alice, userBalance, memo);
      sysIssuer.credit(sysToken, bob, userBalance, memo);

      // Create system symbol
      auto sysSymbol  = SID{"sys"};
      auto numChars   = sysSymbol.str().size();
      auto symbolCost = alice.to<SymbolSys>().getPrice(numChars).returnVal();
      alice.to<TokenSys>().credit(sysToken, SymbolSys::service, symbolCost, memo);
      alice.to<SymbolSys>().create(sysSymbol, symbolCost);

      // Map system symbol to system token
      auto sysSymbolNft = alice.to<SymbolSys>().getSymbol(sysSymbol).returnVal().ownerNft;
      alice.to<NftSys>().credit(sysSymbolNft, TokenSys::service, memo);
      alice.to<TokenSys>().mapSymbol(sysToken, sysSymbol);

      t.startBlock();

      WHEN("Alice creates a symbol")
      {
         auto symbol = SID{"abc"};
         alice.to<TokenSys>().credit(sysToken, SymbolSys::service, symbolCost, memo);
         alice.to<SymbolSys>().create(symbol, symbolCost);

         auto symbolNft        = alice.to<SymbolSys>().getSymbol(symbol).returnVal().ownerNft;
         auto initialNftRecord = alice.to<NftSys>().getNft(symbolNft).returnVal();

         THEN("Alice can list it for sale")
         {
            alice.to<NftSys>().credit(symbolNft, SymbolSys::service, memo);
            CHECK(alice.to<SymbolSys>().listSymbol(symbol, Quantity{1'000e8}).succeeded());

            AND_THEN("Alice no longer owns the symbol")
            {
               t.startBlock();
               auto newNftRecord = alice.to<NftSys>().getNft(symbolNft).returnVal();
               CHECK(newNftRecord != initialNftRecord);

               // Make sure only owner changed
               newNftRecord.owner = alice.id;
               CHECK(newNftRecord == initialNftRecord);
            }
         }
         THEN("Alice cannot list it below the floor price")
         {
            auto listPrice = Quantity{0e8};
            CHECK(alice.to<SymbolSys>().listSymbol(symbol, listPrice).failed(priceTooLow));
         }
         WHEN("The symbol is mapped to a token")
         {
            t.startBlock();
            auto newToken = alice.to<TokenSys>().create(8, userBalance).returnVal();
            alice.to<TokenSys>().mint(newToken, userBalance, memo);
            auto newTokenId = alice.to<TokenSys>().getToken(newToken).returnVal().id;

            alice.to<TokenSys>().mapSymbol(newTokenId, symbol);
            THEN("The symbol cannot be sold")
            {
               CHECK(alice.to<SymbolSys>()
                         .listSymbol(symbol, Quantity{1'000e8})
                         .failed(creditSymbolRequired));
            }
         }
         WHEN("The symbol is for sale")
         {
            auto listPrice = Quantity{1'000e8};
            alice.to<NftSys>().credit(symbolNft, SymbolSys::service, memo);
            alice.to<SymbolSys>().listSymbol(symbol, listPrice);

            THEN("Alice cannot buy the symbol")
            {
               CHECK(alice.to<SymbolSys>().buySymbol(symbol).failed(buyerIsSeller));
            }

            THEN("Bob cannot unlist the symbol")
            {
               CHECK(bob.to<SymbolSys>().unlistSymbol(symbol).failed(missingRequiredAuth));
            }
            THEN("Alice can unlist the symbol")
            {
               CHECK(alice.to<SymbolSys>().unlistSymbol(symbol).succeeded());
            }
            THEN("Bob cannot buy the symbol for less than the list price")
            {
               bob.to<TokenSys>().credit(sysToken, SymbolSys::service, listPrice / 2, memo);
               auto buySymbol = bob.to<SymbolSys>().buySymbol(symbol);
               CHECK(buySymbol.failed(insufficientBalance));
            }
            THEN("Bob can buy the symbol")
            {
               bob.to<TokenSys>().credit(sysToken, SymbolSys::service, listPrice, memo);
               CHECK(bob.to<SymbolSys>().buySymbol(symbol).succeeded());
            }
            AND_WHEN("Bob buys the symbol")
            {
               bob.to<TokenSys>().credit(sysToken, SymbolSys::service, listPrice, memo);
               bob.to<SymbolSys>().buySymbol(symbol);

               THEN("Bob owns the symbol")
               {
                  auto newNftRecord = bob.to<NftSys>().getNft(symbolNft).returnVal();
                  CHECK(newNftRecord.owner == bob.id);

                  newNftRecord.owner = initialNftRecord.owner;
                  CHECK(newNftRecord == initialNftRecord);
               }
               THEN("The symbol is no longer for sale")
               {
                  t.startBlock();
                  auto symbolRecord = alice.to<SymbolSys>().getSymbol(symbol).returnVal();
                  CHECK(symbolRecord.saleDetails.salePrice == 0e8);
               }
               THEN("Bob can reslist the symbol")
               {
                  bob.to<NftSys>().credit(symbolNft, SymbolSys::service, memo);
                  bob.to<SymbolSys>().listSymbol(symbol, listPrice);
               }
            }
         }
      }
   }
}
