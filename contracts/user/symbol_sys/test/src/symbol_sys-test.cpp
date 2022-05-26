#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

// Remove me
#include <contracts/system/transaction_sys.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/common_errors.hpp>
#include <psibase/DefaultTestChain.hpp>

#include "nft_sys.hpp"
#include "symbol_sys.hpp"
#include "token_sys.hpp"

using namespace psibase;
using namespace UserContract;
using namespace UserContract::Errors;

namespace
{
   constexpr bool storageBillingImplemented = false;

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::contract, "token_sys.wasm"},
       {NftSys::contract, "nft_sys.wasm"},
       {SymbolSys::contract, "symbol_sys.wasm"}};

   const String memo{"memo"};
   const TID    sysToken{TokenSys::sysToken};

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
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<SymbolSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<SymbolSys>();

      // Initialize user contracts
      alice.at<NftSys>().init();
      alice.at<TokenSys>().init();
      alice.at<SymbolSys>().init();

      auto tokenContract = t.as(TokenSys::contract).at<TokenSys>();
      tokenContract.mint(sysToken, 20'000e8, memo);
      tokenContract.credit(sysToken, alice, 10'000e8, memo);
      tokenContract.credit(sysToken, bob, 10'000e8, memo);

      t.start_block();

      THEN("Alice cannot create a symbol with numbers")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
         auto symbolId = AccountNumber{"ab1"};
         CHECK(AccountNumber{"ab1"}.value != 0);

         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with uppercase letters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
         auto symbolId = SID{"aBc"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with fewer than 3 characters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
         auto symbolId = SID{"ab"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice cannot create a symbol with greater than 7 characters")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
         auto symbolId = SID{"abcdefgh"};
         CHECK(a.create(symbolId, quantity).failed(invalidSymbol));
      }
      THEN("Alice can create a symbol")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);

         CHECK(quantity == a.getPrice(3).returnVal());

         auto symbolId = SID{"abc"};
         auto create   = a.create(symbolId, quantity);
         CHECK(create.succeeded());

         auto getSymbol = a.getSymbol(symbolId);
         CHECK(getSymbol.succeeded());

         AND_THEN("Alice owns the symbol")
         {
            auto ownerNftId = getSymbol.returnVal().ownerNft;
            auto getNft     = alice.at<NftSys>().getNft(ownerNftId);
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
                alice.at<TokenSys>().getSharedBal(sysToken, alice, NftSys::contract);
            CHECK(getSharedBalance.succeeded());
            CHECK(getSharedBalance.returnVal().balance == 0);
         }

         AND_THEN("Alice cannot create the same symbol again")
         {
            alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
            CHECK(a.create(symbolId, quantity).failed(symbolAlreadyExists));
         }

         AND_THEN("Storage billing is updated correctly")
         {  //
            CHECK(storageBillingImplemented);
         }
      }
      WHEN("Alice creates a symbol")
      {
         auto quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
         auto symbolId = SID{"abc"};
         a.create(symbolId, quantity);
         auto nftId = a.getSymbol(symbolId).returnVal().ownerNft;
         alice.at<NftSys>().debit(nftId, memo);

         THEN("Bob cannot create the same symbol")
         {
            auto credit = bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Alice cannot create the same symbol")
         {
            t.start_block();
            auto create = a.create(SID{"abc"}, quantity);
            CHECK(create.failed(symbolAlreadyExists));
         }
         THEN("Bob can buy a different symbol")
         {
            auto credit = bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);
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
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<SymbolSys>();

      // Initialize user contracts
      alice.at<NftSys>().init();
      alice.at<TokenSys>().init();
      alice.at<SymbolSys>().init();

      auto aliceBalance  = 1'000'000e8;
      auto tokenContract = t.as(TokenSys::contract).at<TokenSys>();
      tokenContract.mint(sysToken, aliceBalance, memo);
      tokenContract.credit(sysToken, alice, aliceBalance, memo);

      t.start_block();

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

         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, 2 * quantity, memo);

         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);

         auto create = a.create(SID{"abc"}, quantity);
         CHECK(create.succeeded());

         AND_THEN("Buying another symbol is the same price")
         {
            CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
            a.create(SID{"bcd"}, quantity);
            auto balance = alice.at<TokenSys>()
                               .getSharedBal(sysToken, alice, NftSys::contract)
                               .returnVal()
                               .balance;
            CHECK(balance == 0);
         }
      }
      THEN("The price remains stable if sold symbols per day is targetNrSymbolsPerDay")
      {
         auto symbolDetails = a.getSymbolType(3).returnVal();
         CHECK(symbolDetails.activePrice == SymbolPricing::initialPrice);
         auto quantity{SymbolPricing::initialPrice};

         // If per day target is updated, unit test needs to be updated
         CHECK(SymbolPricing::targetNrSymbolsPerDay == symbolDetails.targetCreatedPerDay);

         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, 24 * quantity, memo);

         bool costConstant = true;
         for (int i = 0; i < 24 && costConstant; ++i)
         {
            // Todo: Verify they are being created by checking a.getSymbolType(3).returnVal().createCounter;
            a.create(tickers[i], quantity);
            t.start_block();

            costConstant = (a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         }
         CHECK(costConstant);

         AND_THEN("The price for the first create that exceeds the desired rate is higher")
         {
            alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, quantity, memo);

            // Create the 25th symbol within 24 hours, causing the price to increase
            CHECK(a.getSymbolType(3).returnVal().createCounter == 24);
            auto create = a.create(tickers[24], quantity);
            CHECK(create.succeeded());
            t.start_block();

            CHECK(a.getSymbolType(3).returnVal().createCounter == 0);

            auto nextPrice = incrementPrice(SymbolPricing::initialPrice);
            CHECK(a.getPrice(3).returnVal() == nextPrice);
         }
      }
      THEN("The price decreases if less than x are sold over 24 hours")
      {
         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         t.start_block(secondsInDay + 10'000);  // 10 seconds more than a full day has passed

         auto nextPrice = decrementPrice(SymbolPricing::initialPrice);
         CHECK(a.getPrice(3).returnVal() == nextPrice);

         AND_THEN("The price decreases even more if too few are sold over 48 hours")
         {
            t.start_block(secondsInDay + 10'000);  // More than two full days has passed

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
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto bob   = t.as(t.add_account("bob"_a));
      auto a     = alice.at<SymbolSys>();

      // Initialize user contracts
      alice.at<NftSys>().init();
      alice.at<TokenSys>().init();
      alice.at<SymbolSys>().init();

      // Mint token used for purchasing symbols
      auto aliceBalance  = 1'000'000e8;
      auto tokenContract = t.as(TokenSys::contract).at<TokenSys>();
      tokenContract.mint(sysToken, 20'000e8, memo);
      tokenContract.credit(sysToken, alice, aliceBalance, memo);

      // Create the symbol and claim the owner NFT
      auto symbolCost = a.getPrice(3).returnVal();
      alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, symbolCost, memo);
      auto symbolId = SID{"abc"};
      a.create(symbolId, symbolCost);
      auto symbolRecord = a.getSymbol(symbolId).returnVal();
      auto nftId        = symbolRecord.ownerNft;
      alice.at<NftSys>().debit(nftId, memo);

      WHEN("Alice transfers her symbol to Bob")
      {
         alice.at<NftSys>().credit(nftId, bob, memo);
         bob.at<NftSys>().debit(nftId, memo);
         // No additional testing needed to confirm transfers work, as it's piggybacking on NFT transferability

         THEN("The symbol record is identical")
         {
            auto symbolRecord2 = a.getSymbol(symbolId).returnVal();
            CHECK(symbolRecord2 == symbolRecord);
         }
      }
      WHEN("Alice burns her symbol owner NFT")
      {
         alice.at<NftSys>().burn(nftId);

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
      DefaultTestChain t(neededContracts);

      // Add a couple accounts
      auto alice = t.as(t.add_account("alice"_a));
      auto bob   = t.as(t.add_account("bob"_a));

      // Initialize user contracts
      alice.at<NftSys>().init();
      alice.at<TokenSys>().init();
      alice.at<SymbolSys>().init();

      // Fund Alice and Bob with the system token
      auto userBalance   = 1'000'000e8;
      auto tokenContract = t.as(TokenSys::contract).at<TokenSys>();
      tokenContract.mint(sysToken, 2 * userBalance, memo);
      tokenContract.credit(sysToken, alice, userBalance, memo);
      tokenContract.credit(sysToken, bob, userBalance, memo);

      // Create system symbol
      auto sysSymbol  = SID{"sys"};
      auto numChars   = sysSymbol.str().size();
      auto symbolCost = alice.at<SymbolSys>().getPrice(numChars).returnVal();
      alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, symbolCost, memo);
      alice.at<SymbolSys>().create(sysSymbol, symbolCost);

      // Map system symbol to system token
      auto sysSymbolNft = alice.at<SymbolSys>().getSymbol(sysSymbol).returnVal().ownerNft;
      alice.at<NftSys>().credit(sysSymbolNft, TokenSys::contract, memo);
      alice.at<TokenSys>().mapSymbol(sysToken, sysSymbol);

      WHEN("Alice creates a symbol")
      {
         auto symbol = SID{"abc"};
         alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, symbolCost, memo);
         alice.at<SymbolSys>().create(symbol, symbolCost);

         auto symbolNft        = alice.at<SymbolSys>().getSymbol(symbol).returnVal().ownerNft;
         auto initialNftRecord = alice.at<NftSys>().getNft(symbolNft).returnVal();

         THEN("Alice can list it for sale")
         {
            alice.at<NftSys>().credit(symbolNft, SymbolSys::contract, memo);
            CHECK(alice.at<SymbolSys>().listSymbol(symbol, Quantity{1'000e8}).succeeded());

            AND_THEN("Alice no longer owns the symbol")
            {
               auto newNftRecord = alice.at<NftSys>().getNft(symbolNft).returnVal();
               CHECK(newNftRecord != initialNftRecord);

               // Make sure only owner changed
               newNftRecord.owner = alice.id;
               CHECK(newNftRecord == initialNftRecord);
            }
         }
         THEN("Alice cannot list it below the floor price")
         {
            auto listPrice = Quantity{0e8};
            CHECK(alice.at<SymbolSys>().listSymbol(symbol, listPrice).failed(priceTooLow));
         }
         WHEN("The symbol is mapped to a token")
         {
            t.start_block();
            auto newToken = alice.at<TokenSys>().create(8, userBalance).returnVal();
            alice.at<TokenSys>().mint(newToken, userBalance, memo);
            auto newTokenId = alice.at<TokenSys>().getToken(newToken).returnVal().id;

            alice.at<TokenSys>().mapSymbol(newTokenId, symbol);
            THEN("The symbol cannot be sold")
            {
               CHECK(alice.at<SymbolSys>()
                         .listSymbol(symbol, Quantity{1'000e8})
                         .failed(creditSymbolRequired));
            }
         }
         WHEN("The symbol is for sale")
         {
            auto listPrice = Quantity{1'000e8};
            alice.at<NftSys>().credit(symbolNft, SymbolSys::contract, memo);
            alice.at<SymbolSys>().listSymbol(symbol, listPrice);

            THEN("Alice cannot buy the symbol")
            {
               CHECK(alice.at<SymbolSys>().buySymbol(symbol).failed(buyerIsSeller));
            }

            THEN("Bob cannot unlist the symbol")
            {
               CHECK(bob.at<SymbolSys>().unlistSymbol(symbol).failed(missingRequiredAuth));
            }
            THEN("Alice can unlist the symbol")
            {
               CHECK(alice.at<SymbolSys>().unlistSymbol(symbol).succeeded());
            }
            THEN("Bob cannot buy the symbol for less than the list price")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice / 2, memo);
               auto buySymbol = bob.at<SymbolSys>().buySymbol(symbol);
               CHECK(buySymbol.failed(insufficientBalance));
            }
            THEN("Bob can buy the symbol")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice, memo);
               CHECK(bob.at<SymbolSys>().buySymbol(symbol).succeeded());
            }
            AND_WHEN("Bob buys the symbol")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice, memo);
               bob.at<SymbolSys>().buySymbol(symbol);

               THEN("Bob owns the symbol")
               {
                  auto newNftRecord = bob.at<NftSys>().getNft(symbolNft).returnVal();
                  CHECK(newNftRecord.owner == bob.id);

                  newNftRecord.owner = initialNftRecord.owner;
                  CHECK(newNftRecord == initialNftRecord);
               }
               THEN("The symbol is no longer for sale")
               {
                  auto symbolRecord = alice.at<SymbolSys>().getSymbol(symbol).returnVal();
                  CHECK(symbolRecord.saleDetails.salePrice == 0e8);
               }
               THEN("Bob can reslist the symbol")
               {
                  bob.at<NftSys>().credit(symbolNft, SymbolSys::contract, memo);
                  bob.at<SymbolSys>().listSymbol(symbol, listPrice);
               }
            }
         }
      }
   }
}
