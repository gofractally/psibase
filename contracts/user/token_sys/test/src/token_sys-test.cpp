#define CATCH_CONFIG_MAIN

#include "token_sys.hpp"

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
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

}  // namespace

/* Todo:
 *    Implement inflation limits
 *    Implement state management classes, or helpers that assert if objects don't exist.
 *    Templatize psibase::Bitset
 *    Test Precision and Quantity types
 *    Code review psibase::Bitset/Flags and psibase::String
 *    Code review token tables
 *    Code review UserContext class in Tester
 *    Consider if stake/unstake should be native token actions, and if there should be a stake recipient field.
 *    Flag type should be used for the autodebit flag in NFT contract as well
 *    Flag should be changed to manualDebit in NFT contract as well
 *    We should allow users to configure a management contract to be notified when they debit from their account.
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
         CHECK(false);
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
            CHECK(getBalanceAlice.returnVal() == 1000);

            CHECK(getBalanceBob.succeeded());
            CHECK(getBalanceBob.returnVal() == 1000);
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

SCENARIO("Setting flags")
{
   // Todo - test setting invalid flags fails
   // Should flags be defineable by child contracts? Or do we define all token flags?
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
         CHECK(false == token.flags.get(TokenRecord::unrecallable));
      }
      THEN("Alice can recall Bob's tokens")
      {
         auto recall = a.recall(tokenId, bob, alice, 1000, memo);
         CHECK(recall.succeeded());
         auto debit = a.debit(tokenId, bob, 1000, memo);
         CHECK(debit.succeeded());

         AND_THEN("Alice owns Bob's tokens")
         {
            CHECK(a.getBalance(tokenId, bob).returnVal() == 0);
            CHECK(a.getBalance(tokenId, alice).returnVal() == 1000);
         }
      }
      THEN("The token issuer may turn off recallability")
      {
         CHECK(a.set(tokenId, TokenRecord::unrecallable).succeeded());
         auto unrecallable = a.getToken(tokenId).returnVal().flags.get(TokenRecord::unrecallable);
         CHECK(true == unrecallable);

         AND_THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, alice, 1000, memo).failed(tokenUnrecallable));
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
            CHECK(a.recall(tokenId, bob, alice, 1000, memo).failed(missingRequiredAuth));
         }
         THEN("Bob may recall Alice's tokens")
         {
            b.mint(tokenId, 1000, alice, memo);
            CHECK(b.recall(tokenId, alice, bob, 1000, memo).succeeded());
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
            CHECK(alice.at<NftSys>().credit(nft.id, bob, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, alice, 1000, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not update the token inflation")
         {  //
            CHECK(inflationLimitsImplemented);
         }
         THEN("Alice may not update the token recallability")
         {
            CHECK(a.set(tokenId, TokenRecord::unrecallable).failed(missingRequiredAuth));
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
            CHECK(a.getBalance(tokenId, alice).returnVal() == 40);
         }
         THEN("Bob still owns 100 tokens")
         {  //
            CHECK(b.getBalance(tokenId, bob).returnVal() == 100);
         }
      }
      WHEN("Alice burns 100 tokens")
      {
         a.burn(tokenId, 100);

         THEN("Her balance is 0")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal() == 0);
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
               CHECK(b.getBalance(tokenId, bob).returnVal() == 90);
            }
            THEN("Alice still has 0 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal() == 0);
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
         auto isManualDebit1 = a.isManualDebit(alice);
         REQUIRE(isManualDebit1.succeeded());
         CHECK(isManualDebit1.returnVal() == false);

         auto isManualDebit2 = a.isManualDebit(bob);
         REQUIRE(isManualDebit2.succeeded());
         CHECK(isManualDebit2.returnVal() == false);
      }
      THEN("Alice may enable manual-debit")
      {  //
         CHECK(a.manualDebit(true).succeeded());
      }
      WHEN("Alice enabled manual-debit")
      {
         a.manualDebit(true);

         THEN("Alice has manual-debit enabled")
         {  //
            CHECK(a.isManualDebit(alice).returnVal() == true);
         }
         THEN("Bob still has manual-debit disabled")
         {  //
            CHECK(a.isManualDebit(bob).returnVal() == false);
         }
         THEN("Alice may not enable manual-debit again")
         {
            CHECK(a.manualDebit(true).failed(manualDebitEnabled));

            AND_THEN("But Bob may enable manual-debit")
            {  //
               CHECK(b.manualDebit(true).succeeded());
            }
         }
         THEN("Alice may disable manual-debit")
         {  //
            CHECK(a.manualDebit(false).succeeded());
         }
         WHEN("Alice disabled manual-debit")
         {
            a.manualDebit(false);

            THEN("Alice has manual-debit disabled")
            {  //
               CHECK(a.isManualDebit(alice).returnVal() == false);
            }
            THEN("Bob still has manual-debit disabled")
            {
               CHECK(a.isManualDebit(bob).returnVal() == false);
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
            CHECK(b.getBalance(tokenId, bob).returnVal() == 200);
         }
         THEN("Alice immediately has 0 tokens")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal() == 0);
         }
         THEN("Alice may not credit Bob 1 token")
         {
            CHECK(a.credit(tokenId, bob, 1, memo).failed(insufficientBalance));
         }
         THEN("Bob may not debit any tokens")
         {
            CHECK(b.debit(tokenId, alice, 1, memo).failed(debitRequiresCredit));
         }
         THEN("Alice may not uncredit any tokens")
         {
            CHECK(a.uncredit(tokenId, bob, 1, memo).failed(uncreditRequiresCredit));
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
               CHECK(b.getBalance(tokenId, bob).returnVal() == 190);
            }
            THEN("Alice has 10 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal() == 10);
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
         a.manualDebit(true);

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
               CHECK(150 == b.getBalance(tokenId, bob).returnVal());
               CHECK(50 == a.getBalance(tokenId, alice).returnVal());
            }
            THEN("Alice and Bob may not uncredit any tokens")
            {
               CHECK(a.uncredit(tokenId, bob, 50, memo).failed(uncreditRequiresCredit));
               CHECK(b.uncredit(tokenId, alice, 50, memo).failed(uncreditRequiresCredit));
            }
            THEN("Alice and Bob may not debit any tokens")
            {
               CHECK(a.debit(tokenId, bob, 50, memo).failed(debitRequiresCredit));
               CHECK(b.debit(tokenId, alice, 50, memo).failed(debitRequiresCredit));
            }
         }
         WHEN("Bob credits Alice 50 tokens")
         {
            b.credit(tokenId, alice, 50, memo);

            THEN("Bob owns 50 tokens in his individual balance")
            {
               CHECK(50 == b.getBalance(tokenId, bob).returnVal());
               AND_THEN("Bob owns 50 tokens in his shared balance with Alice")
               {
                  CHECK(50 == b.getSharedBal(tokenId, bob, alice).returnVal());
               }
            }
            THEN("Bob may not uncredit 51 tokens")
            {
               CHECK(b.uncredit(tokenId, alice, 51, memo).failed(insufficientBalance));
            }
            THEN("Bob may uncredit 25 tokens")
            {
               CHECK(b.uncredit(tokenId, alice, 25, memo).succeeded());
               AND_THEN("Bob may not uncredit 26 tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 26, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may uncredit 25 tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 25, memo).succeeded());
                  AND_THEN("Bob owns 0 tokens in his shared balance with Alice")
                  {
                     CHECK(0 == b.getSharedBal(tokenId, bob, alice).returnVal());
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
