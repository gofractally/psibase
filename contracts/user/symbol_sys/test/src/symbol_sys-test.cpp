#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <contracts/system/account_sys.hpp>
#include <psibase/DefaultTestChain.hpp>

#include "nft_sys.hpp"
#include "symbol_sys.hpp"
#include "token_sys.hpp"

using namespace psibase;
using namespace UserContract;
using namespace UserContract::Errors;

/***** Questions *****
 * How should symbol pricing be updated?
 * Prices different for different number of characters?
 * How does the symbol contract bill users? It must use a "system" token?
 * 
*/

namespace
{
   constexpr bool storageBillingImplemented = false;

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::contract, "token_sys.wasm"},
       {NftSys::contract, "nft_sys.wasm"},
       {SymbolSys::contract, "symbol_sys.wasm"}};

   const psibase::String memo{"memo"};

   using Quantity_t = Quantity::Quantity_t;

   namespace SymbolPricing
   {
      const auto initialPrice           = static_cast<Quantity_t>(1'000e8);
      const int  increaseRatePct        = 5;
      const int  decreaseRatePct        = 5;
      const int  targetNrSymbolsPerHour = 1;
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

      auto tokenId = alice.at<TokenSys>().create(8, 1'000'000e8).returnVal();
      alice.at<TokenSys>().mint(tokenId, 10'000e8, alice, memo);
      alice.at<TokenSys>().mint(tokenId, 10'000e8, bob, memo);

      t.start_block();

      THEN("A symbol does not exist")
      {
         CHECK(a.getSymbol(SID{0}).failed(symbolDNE));
         CHECK(a.getSymbol(SID{1}).failed(symbolDNE));
      }
      THEN("Alice can buy a symbol")
      {
         Quantity quantity{SymbolPricing::initialPrice};
         auto credit = alice.at<TokenSys>().credit(tokenId, SymbolSys::contract, quantity, memo);
         CHECK(credit.succeeded());

         auto symbolId = "abc"_a;
         auto create   = a.create(symbolId, quantity);
         CHECK(create.succeeded());

         auto getSymbol = a.getSymbol(symbolId);
         CHECK(getSymbol.succeeded());

         auto ownerNftId = getSymbol.returnVal().ownerNft;
         auto debit      = alice.at<NftSys>().debit(ownerNftId, memo);
         CHECK(debit.succeeded());

         AND_THEN("Alice owns the symbol")
         {
            auto getNft = alice.at<NftSys>().getNft(ownerNftId);
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
                alice.at<TokenSys>().getSharedBal(tokenId, alice, NftSys::contract);
            CHECK(getSharedBalance.succeeded());
            CHECK(getSharedBalance.returnVal().balance == 0);
         }

         AND_THEN("Storage billing is updated correctly")
         {  //
            CHECK(storageBillingImplemented);
         }
      }
      WHEN("Alice buys a symbol")
      {
         auto quantity{SymbolPricing::initialPrice};
         alice.at<TokenSys>().credit(tokenId, SymbolSys::contract, quantity, memo);
         auto symbolId = "abc"_a;
         a.create(symbolId, quantity);
         auto nftId = a.getSymbol(symbolId).returnVal().ownerNft;
         alice.at<NftSys>().debit(nftId, memo);

         THEN("Bob cannot buy the same symbol")
         {
            auto credit = bob.at<TokenSys>().credit(tokenId, SymbolSys::contract, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create("abc"_a, quantity);
            CHECK(create.failed(symbolUnavailable));
         }
         THEN("Alice cannot buy the same symbol")
         {
            t.start_block();  // Preventing duplicate transaction detection
            auto create = a.create("abc"_a, quantity);
            CHECK(create.failed(symbolUnavailable));
         }
         THEN("Bob can buy a different symbol")
         {
            auto credit = bob.at<TokenSys>().credit(tokenId, SymbolSys::contract, quantity, memo);
            REQUIRE(credit.succeeded());

            auto create = b.create("bcd"_a, quantity);
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

      auto aliceBalance = 1'000'000e8;

      auto tokenId = alice.at<TokenSys>().create(8, aliceBalance).returnVal();
      alice.at<TokenSys>().mint(tokenId, aliceBalance, alice, memo);

      t.start_block();

      std::vector<SID> tickers{
          // 25 tickers
          "abc"_a, "abf"_a, "abi"_a, "abl"_a, "abo"_a, "abr"_a, "abu"_a, "abx"_a, "abz"_a,
          "abd"_a, "abg"_a, "abj"_a, "abm"_a, "abp"_a, "abs"_a, "abv"_a, "aby"_a, "azz"_a,
          "abe"_a, "abh"_a, "abk"_a, "abn"_a, "abq"_a, "abt"_a, "abw"_a,
      };

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

         alice.at<TokenSys>().credit(tokenId, SymbolSys::contract, 2 * quantity, memo);
         auto getSharedBalance =
             alice.at<TokenSys>().getSharedBal(tokenId, alice, NftSys::contract);
         CHECK(getSharedBalance.returnVal().balance == SymbolPricing::initialPrice);

         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         a.create("abc"_a, quantity);

         AND_THEN("Buying another symbol is the same price")
         {
            CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
            a.create("bcd"_a, quantity);
            auto balance = alice.at<TokenSys>()
                               .getSharedBal(tokenId, alice, NftSys::contract)
                               .returnVal()
                               .balance;
            CHECK(balance == 0);
         }
      }
      THEN("The price remains stable if sold symbols per hour is targetNrSymbolsPerHour")
      {
         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         auto quantity{SymbolPricing::initialPrice};

         // Unit test needs to be udpated if the target nr symbols per hour is not 1.
         CHECK(SymbolPricing::targetNrSymbolsPerHour == 1);

         bool costConstant = true;
         for (int i = 0; i < 24 && costConstant; ++i)
         {
            a.create(tickers[i], quantity);
            t.start_block();

            costConstant = a.getPrice(3).returnVal() == SymbolPricing::initialPrice;
         }
         CHECK(costConstant);

         AND_THEN("The price for the first create that exceeds the desired rate is higher")
         {
            auto nextPrice = incrementPrice(SymbolPricing::initialPrice);

            CHECK(a.getPrice(3).returnVal() == nextPrice);
         }
      }
      THEN("The price decreases if less than x are sold over 24 hours")
      {
         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         t.start_block((1'000 * 60 * 24) + 1);  // More than a full day has passed

         auto nextPrice = decrementPrice(SymbolPricing::initialPrice);
         CHECK(a.getPrice(3).returnVal() == nextPrice);
      }
      THEN("The price decreases even more if too few are sold over 48 hours")
      {
         CHECK(a.getPrice(3).returnVal() == SymbolPricing::initialPrice);
         t.start_block((1'000 * 60 * 24 * 2) + 1);  // More than two full days has passed

         auto nextPrice = decrementPrice(SymbolPricing::initialPrice);
         nextPrice      = decrementPrice(nextPrice);
         CHECK(a.getPrice(3).returnVal() == nextPrice);
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

      // Mint token used for purchasing symbols
      auto aliceBalance = 1'000'000e8;
      auto sysToken     = alice.at<TokenSys>().create(8, aliceBalance).returnVal();
      alice.at<TokenSys>().mint(sysToken, aliceBalance, alice, memo);

      // Create the symbol and claim the owner NFT
      auto symbolCost = a.getPrice(3).returnVal();
      alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, symbolCost, memo);
      auto symbolId = "abc"_a;
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

      // Create the system token and fund Alice and Bob
      auto sysSupply   = 1'000'000e8;
      auto sysToken    = alice.at<TokenSys>().create(8, sysSupply).returnVal();
      auto userBalance = 100'000e8;
      alice.at<TokenSys>().mint(sysToken, userBalance, alice, memo);
      alice.at<TokenSys>().mint(sysToken, userBalance, bob, memo);

      // Create system symbol
      auto sysSymbol  = SID{"sys"_a};
      auto numChars   = static_cast<uint8_t>(sysSymbol.str().size());
      auto symbolCost = alice.at<SymbolSys>().getPrice(numChars).returnVal();
      alice.at<TokenSys>().credit(sysToken, SymbolSys::contract, symbolCost, memo);
      alice.at<SymbolSys>().create(sysSymbol, symbolCost);

      // Map system symbol to system token
      auto sysSymbolNft = alice.at<SymbolSys>().getSymbol(sysSymbol).returnVal().ownerNft;
      alice.at<NftSys>().credit(sysSymbolNft, TokenSys::contract, memo);
      alice.at<TokenSys>().mapSymbol(sysToken, sysSymbol);

      WHEN("Alice creates a symbol")
      {
         auto symbol = SID{"abc"_a};
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
            alice.at<TokenSys>().mint(newToken, userBalance, alice, memo);
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
               CHECK(alice.at<SymbolSys>().buysymbol(symbol).failed(buyerIsSeller));
            }

            THEN("Bob cannot unlist the symbol")
            {
               CHECK(bob.at<SymbolSys>().unlistSymbol(symbol).failed(missingRequiredAuth));
            }
            THEN("Alice can unlist the symbol")
            {
               CHECK(alice.at<SymbolSys>().unlistSymbol(symbol).succeeded());

               AND_THEN("Alice can debit the symbol")
               {
                  CHECK(alice.at<NftSys>().debit(symbolNft, memo).succeeded());
               }
            }
            THEN("Bob cannot buy the symbol for less than the list price")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice / 2, memo);
               auto buySymbol = bob.at<SymbolSys>().buysymbol(symbol);
               CHECK(buySymbol.failed(insufficientFunds));
            }
            THEN("Bob can buy the symbol")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice, memo);
               CHECK(bob.at<SymbolSys>().buysymbol(symbol).succeeded());
            }
            AND_WHEN("Bob buys the symbol")
            {
               bob.at<TokenSys>().credit(sysToken, SymbolSys::contract, listPrice, memo);
               bob.at<SymbolSys>().buysymbol(symbol);

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
                  CHECK(symbolRecord.salePrice == 0e8);
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
