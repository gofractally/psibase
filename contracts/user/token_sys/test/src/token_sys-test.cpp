#define CATCH_CONFIG_MAIN

#include "token_sys.hpp"

#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>

using namespace psibase;
using namespace psibase::benchmarking;
using UserContract::TokenSys;
using namespace UserContract::Errors;
using namespace UserContract;

namespace
{
   constexpr bool storageBillingImplemented  = false;
   constexpr bool inflationLimitsImplemented = false;
   constexpr bool tokenSymbolsSupported      = false;

   struct DiskUsage_TokenRecord
   {
      static constexpr int64_t firstEmplace      = 100;
      static constexpr int64_t subsequentEmplace = 100;
      static constexpr int64_t update            = 100;
   };

   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::contract, "token_sys.wasm"},
       {NftSys::contract, "nft_sys.wasm"}};

   constexpr auto manualDebit  = "manualDebit"_m;
   constexpr auto unrecallable = "unrecallable"_m;

}  // namespace

/* Todo:
 *    Templatize psibase::Bitset
 *    Test Precision and Quantity types
 *    Code review psibase::Bitset and psibase::String
 *    Code review token tables
 *    Code review UserContext class in Tester
 *    Add test cases for verifying events were emitted properly in this and nft tests
*/

SCENARIO("Creating a token")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));

      THEN("Alice may create a token")
      {
         auto create = a.create(8, 1'000'000'000);
         CHECK(create.succeeded());

         AND_THEN("The token exists")
         {
            auto tokenId = create.returnVal();
            CHECK(a.getToken(tokenId).succeeded());
         }
         AND_THEN("Billing is correct")
         {  //
            CHECK(storageBillingImplemented);
         }
      }
      WHEN("Alice creates a token")
      {
         auto tokenId = a.create(8, 1'000'000'000).returnVal();
         auto token1  = a.getToken(tokenId).returnVal();

         THEN("Alice may create a second token")
         {
            t.start_block();

            auto create = a.create(8, 1'000'000'000);
            CHECK(create.succeeded());

            auto tokenId   = create.returnVal();
            auto getToken2 = a.getToken(tokenId);
            CHECK(getToken2.succeeded());

            auto token2 = getToken2.returnVal();

            AND_THEN("The owner NFT is different from the first token owner NFT")
            {
               CHECK(token1.ownerNft != token2.ownerNft);
            }
         }
      }
   }
}

SCENARIO("Minting tokens")
{
   GIVEN("Alice created a token")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();

      THEN("Bob may not mint them")
      {
         auto mint = b.mint(tokenId, 1000, bob, memo);
         CHECK(mint.failed(missingRequiredAuth));
      }
      THEN("Alice may not mint them with an invalid token ID")
      {
         auto mint = a.mint(999, 1000, alice, memo);
         CHECK(mint.failed(invalidTokenId));
      }
      THEN("Alice may not mint them to an invalid Account")
      {
         auto mint = a.mint(tokenId, 1000, "notreal"_a, memo);
         CHECK(mint.failed(invalidAccount));
      }
      THEN("Alice may not mint more tokens than are allowed by the specified max supply")
      {
         CHECK(a.mint(tokenId, 1'000'000'001, alice, memo).failed(maxSupplyExceeded));
      }
      THEN("Alice may mint new tokens")
      {
         auto mint1 = a.mint(tokenId, 1000, alice, memo);
         auto mint2 = a.mint(tokenId, 1000, bob, memo);
         CHECK(mint1.succeeded());
         CHECK(mint2.succeeded());

         AND_THEN("The tokens were allocated accordingly")
         {
            auto getBalanceAlice = a.getBalance(tokenId, alice);
            auto getBalanceBob   = b.getBalance(tokenId, bob);

            CHECK(getBalanceAlice.succeeded());
            CHECK(getBalanceAlice.returnVal().balance == 1000);

            CHECK(getBalanceBob.succeeded());
            CHECK(getBalanceBob.returnVal().balance == 1000);
         }
         AND_THEN("Storage was billed correctly")
         {  //
            CHECK(storageBillingImplemented);
         }
      }
   }

   GIVEN("A token created by Alice with inflation limits")
   {
      CHECK(inflationLimitsImplemented);

      THEN("Alice may not exceed those inflation limits")
      {  //
         CHECK(inflationLimitsImplemented);
      }
      THEN("Alice may not raise those inflation limits")
      {  //
         CHECK(inflationLimitsImplemented);
      }
   }
}

SCENARIO("Recalling tokens")
{
   GIVEN("Alice created a new token and issued some to Bob")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      a.mint(tokenId, 1000, bob, memo);

      THEN("The token is recallable by default")
      {
         auto unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);
         CHECK(false == token.config.get(unrecallableBit));
      }
      THEN("Alice can recall Bob's tokens")
      {
         auto recall = a.recall(tokenId, bob, 1000, memo);
         CHECK(recall.succeeded());

         AND_THEN("Bob's token balance has decreased")
         {
            CHECK(a.getBalance(tokenId, bob).returnVal().balance == 0);
         }
         AND_THEN("Alice's token balance has not changed")
         {
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0);
         }
      }
      THEN("The token issuer may turn off recallability")
      {
         CHECK(a.setUnrecallable(tokenId).succeeded());

         auto unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);
         CHECK(a.getToken(tokenId).returnVal().config.get(unrecallableBit));

         AND_THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, 1000, memo).failed(tokenUnrecallable));
         }
      }
   }
}

SCENARIO("Interactions with the Issuer NFT")
{
   GIVEN("Alice created and distributed a token")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto nft     = alice.at<NftSys>().getNft(token.ownerNft).returnVal();

      THEN("The Issuer NFT is owned by Alice") { CHECK(nft.owner == alice.id); }
      WHEN("Alice credits the issuer NFT to Bob")
      {
         alice.at<NftSys>().credit(nft.id, bob, memo);

         THEN("The NFT is owned by Bob")
         {
            auto newNft = alice.at<NftSys>().getNft(token.ownerNft).returnVal();
            nft.owner   = bob.id;
            CHECK(newNft == nft);
         }
         THEN("The token record is identical")
         {  //
            CHECK(a.getToken(tokenId).returnVal() == token);
         }
         THEN("Bob may mint new tokens")
         {  //
            CHECK(b.mint(tokenId, 1000, bob, memo).succeeded());
         }
         THEN("Alice may not mint new tokens")
         {
            CHECK(a.mint(tokenId, 1000, alice, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not recall Bob's tokens")
         {
            b.mint(tokenId, 1000, bob, memo);
            CHECK(a.recall(tokenId, bob, 1000, memo).failed(missingRequiredAuth));
         }
         THEN("Bob may recall Alice's tokens")
         {
            b.mint(tokenId, 1000, alice, memo);
            CHECK(b.recall(tokenId, alice, 1000, memo).succeeded());
         }
      }
      WHEN("Alice burns the issuer NFT")
      {
         a.mint(tokenId, 1000, bob, memo);
         alice.at<NftSys>().burn(nft.id);

         THEN("Alice may not mint new tokens")
         {
            CHECK(a.mint(tokenId, 1000, alice, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not credit the issuer NFT to anyone")
         {
            CHECK(alice.at<NftSys>().credit(nft.id, bob, memo).failed(nftDNE));
         }
         THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, 1000, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not update the token inflation")
         {  //
            CHECK(inflationLimitsImplemented);
         }
         THEN("Alice may not update the token recallability")
         {
            CHECK(a.setUnrecallable(tokenId).failed(missingRequiredAuth));
         }
      }
   }
}

SCENARIO("Burning tokens")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto mint    = a.mint(tokenId, 100, alice, memo);
      auto mint2   = a.mint(tokenId, 100, bob, memo);

      THEN("Alice may not burn 101 tokens")
      {
         CHECK(a.burn(tokenId, 101).failed(insufficientBalance));
      }
      THEN("Alice may burn 60 tokens")
      {
         CHECK(a.burn(tokenId, 60).succeeded());

         AND_THEN("Alice may not burn 41 more")
         {
            CHECK(a.burn(tokenId, 41).failed(insufficientBalance));
         }
         AND_THEN("Alice may burn 40 more")
         {  //
            CHECK(a.burn(tokenId, 40).succeeded());
         }
      }
      WHEN("Alice burns 60 tokens")
      {
         a.burn(tokenId, 60);

         THEN("She still owns 40 tokens")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 40);
         }
         THEN("Bob still owns 100 tokens")
         {  //
            CHECK(b.getBalance(tokenId, bob).returnVal().balance == 100);
         }
      }
      WHEN("Alice burns 100 tokens")
      {
         a.burn(tokenId, 100);

         THEN("Her balance is 0")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0);
         }
         THEN("She may not burn any more")
         {
            CHECK(a.burn(tokenId, 1).failed(insufficientBalance));
         }
         THEN("Bob may burn tokens")
         {  //
            CHECK(b.burn(tokenId, 10).succeeded());
         }
         AND_WHEN("Bob burns 10 tokens")
         {
            b.burn(tokenId, 10);

            THEN("Bob still has 90 tokens")
            {  //
               CHECK(b.getBalance(tokenId, bob).returnVal().balance == 90);
            }
            THEN("Alice still has 0 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0);
            }
         }
      }
   }
}

SCENARIO("Toggling manual-debit")
{
   GIVEN("A chain with users Alice and Bob")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      THEN("Alice and Bob both have manualDebit disabled")
      {
         auto isManualDebit1 = a.getConfig(alice, manualDebit);
         REQUIRE(isManualDebit1.succeeded());
         CHECK(isManualDebit1.returnVal() == false);

         auto isManualDebit2 = a.getConfig(bob, manualDebit);
         REQUIRE(isManualDebit2.succeeded());
         CHECK(isManualDebit2.returnVal() == false);
      }
      THEN("Alice may enable manual-debit")
      {  //
         CHECK(a.setConfig(manualDebit, true).succeeded());
      }
      WHEN("Alice enabled manual-debit")
      {
         a.setConfig(manualDebit, true);

         THEN("Alice has manual-debit enabled")
         {  //
            CHECK(a.getConfig(alice, manualDebit).returnVal() == true);
         }
         THEN("Bob still has manual-debit disabled")
         {  //
            CHECK(a.getConfig(bob, manualDebit).returnVal() == false);
         }
         THEN("Alice may not enable manual-debit again")
         {
            CHECK(a.setConfig(manualDebit, true).failed(redundantUpdate));

            AND_THEN("But Bob may enable manual-debit")
            {  //
               CHECK(b.setConfig(manualDebit, true).succeeded());
            }
         }
         THEN("Alice may disable manual-debit")
         {  //
            CHECK(a.setConfig(manualDebit, false).succeeded());

            AND_THEN("Alice has manual-debit disabled")
            {  //
               CHECK(a.getConfig(alice, manualDebit).returnVal() == false);
            }
            AND_THEN("Bob still has manual-debit disabled")
            {
               CHECK(a.getConfig(bob, manualDebit).returnVal() == false);
            }
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto mint    = a.mint(tokenId, 100, alice, memo);
      auto mint2   = a.mint(tokenId, 100, bob, memo);

      THEN("Alice may not credit Bob 101 tokens")
      {
         CHECK(a.credit(tokenId, bob, 101, memo).failed(insufficientBalance));
      }
      THEN("Alice may credit Bob 100 tokens")
      {
         CHECK(a.credit(tokenId, bob, 100, memo).succeeded());
      }
      WHEN("Alice credits Bob 100 tokens")
      {
         a.credit(tokenId, bob, 100, memo);

         THEN("Bob immediately has 200 tokens")
         {  //
            CHECK(b.getBalance(tokenId, bob).returnVal().balance == 200);
         }
         THEN("Alice immediately has 0 tokens")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0);
         }
         THEN("Alice may not credit Bob 1 token")
         {
            CHECK(a.credit(tokenId, bob, 1, memo).failed(insufficientBalance));
         }
         THEN("Bob may not debit any tokens")
         {
            CHECK(b.debit(tokenId, alice, 1, memo).failed(insufficientBalance));
         }
         THEN("Alice may not uncredit any tokens")
         {
            CHECK(a.uncredit(tokenId, bob, 1, memo).failed(insufficientBalance));
         }
         THEN("Bob may credit Alice 10 tokens")
         {
            CHECK(b.credit(tokenId, alice, 10, memo).succeeded());
         }
         AND_WHEN("Bob credits Alice 10 tokens")
         {
            b.credit(tokenId, alice, 10, memo);

            THEN("Bob has 190 tokens")
            {  //
               CHECK(b.getBalance(tokenId, bob).returnVal().balance == 190);
            }
            THEN("Alice has 10 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal().balance == 10);
            }
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens, with manual-debit")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededContracts);

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto mint    = a.mint(tokenId, 100, alice, memo);
      auto mint2   = a.mint(tokenId, 100, bob, memo);

      AND_GIVEN("Alice turns on manual-debit")
      {
         a.setConfig(manualDebit, true);

         THEN("Alice may credit Bob 50 tokens")
         {
            CHECK(a.credit(tokenId, bob, 50, memo).succeeded());
         }
         THEN("Bob may credit Alice 50 tokens")
         {
            CHECK(b.credit(tokenId, alice, 50, memo).succeeded());
         }
         WHEN("Alice credits Bob 50 tokens")
         {
            a.credit(tokenId, bob, 50, memo);

            THEN("The transfer happens immediately")
            {
               CHECK(150 == b.getBalance(tokenId, bob).returnVal().balance);
               CHECK(50 == a.getBalance(tokenId, alice).returnVal().balance);
            }
            THEN("Alice and Bob may not uncredit any tokens")
            {
               CHECK(a.uncredit(tokenId, bob, 50, memo).failed(insufficientBalance));
               CHECK(b.uncredit(tokenId, alice, 50, memo).failed(insufficientBalance));
            }
            THEN("Alice and Bob may not debit any tokens")
            {
               CHECK(a.debit(tokenId, bob, 50, memo).failed(insufficientBalance));
               CHECK(b.debit(tokenId, alice, 50, memo).failed(insufficientBalance));
            }
         }
         WHEN("Bob credits Alice 50 tokens")
         {
            b.credit(tokenId, alice, 50, memo);

            THEN("Bob owns 50 tokens in his individual balance")
            {
               CHECK(50 == b.getBalance(tokenId, bob).returnVal().balance);
               AND_THEN("Bob owns 50 tokens in his shared balance with Alice")
               {
                  CHECK(50 == b.getSharedBal(tokenId, bob, alice).returnVal().balance);
               }
            }
            THEN("Bob may not uncredit 51 tokens")
            {
               CHECK(b.uncredit(tokenId, alice, 51, memo).failed(insufficientBalance));
            }
            THEN("Bob may uncredit 25 tokens")
            {
               CHECK(b.uncredit(tokenId, alice, 25, memo).succeeded());
               t.start_block();
               AND_THEN("Bob may not uncredit 26 tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 26, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may uncredit 25 tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 25, memo).succeeded());
                  AND_THEN("Bob owns 0 tokens in his shared balance with Alice")
                  {
                     CHECK(0 == b.getSharedBal(tokenId, bob, alice).returnVal().balance);
                  }
               }
               AND_THEN("Alice may not debit 26 tokens")
               {
                  CHECK(a.debit(tokenId, bob, 26, memo).failed(insufficientBalance));
               }
               AND_THEN("Alice may debit 25 tokens")
               {
                  CHECK(a.debit(tokenId, bob, 25, memo).succeeded());
                  AND_THEN("Bob has 0 tokens in his shared balance with Alice")
                  {
                     CHECK(0 == b.getSharedBal(tokenId, bob, alice).returnVal());
                  }
                  AND_THEN("Bob owns 75 tokens in his individual balance")
                  {
                     CHECK(75 == b.getBalance(tokenId, bob).returnVal());
                  }
                  AND_THEN("Alice owns 125 tokens in her individual balance")
                  {
                     CHECK(125 == a.getBalance(tokenId, alice).returnVal());
                  }
               }
            }
            THEN("Alice may not debit 51 tokens")
            {
               CHECK(a.debit(tokenId, bob, 51, memo).failed(insufficientBalance));
            }
            THEN("Alice may debit 50 tokens")
            {
               CHECK(a.debit(tokenId, bob, 50, memo).succeeded());
               AND_THEN("Alice may not debit any more tokens")
               {
                  CHECK(a.debit(tokenId, bob, 1, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may not uncredit any more tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 1, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may credit an additional 25 tokens")
               {
                  CHECK(b.credit(tokenId, alice, 25, memo).succeeded());
               }
            }
         }
      }
   }
}
