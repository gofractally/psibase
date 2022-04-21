#define CATCH_CONFIG_MAIN

#include "token_sys.hpp"

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using UserContract::TokenSys;
using namespace UserContract::Errors;
using namespace UserContract;

namespace
{
   constexpr bool storageBillingImplemented = false;

   struct DiskUsage_TokenRecord
   {
      static constexpr int64_t firstEmplace      = 100;
      static constexpr int64_t subsequentEmplace = 100;
      static constexpr int64_t update            = 100;
   };

}  // namespace

SCENARIO("Data type tests")
{
   // Test Precision
   // Test Quantity
}

SCENARIO("Creating a token")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t({{TokenSys::contract, "token_sys.wasm"}});

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));

      THEN("Alice may create a token")
      {
         auto create = a.create(8, 1'000'000'000);
         CHECK(create.succeeded());

         AND_THEN("The token exists")
         {
            auto tokenId     = create.returnVal();
            auto tokenRecord = a.getToken(tokenId).returnVal();

            CHECK(tokenRecord.has_value());
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

            auto tokenId = create.returnVal();
            auto token2  = a.getToken(tokenId).returnVal();
            CHECK(token2.has_value());

            AND_THEN("The owner NFT is different from the first token owner NFT")
            {
               CHECK(token1->ownerNft != token2->ownerNft);
            }
         }
      }
   }
}

SCENARIO("Minting tokens")
{
   GIVEN("Alice created a token")
   {
      DefaultTestChain t({{TokenSys::contract, "token_sys.wasm"}});

      auto alice = t.as(t.add_account("alice"_a));
      auto a     = alice.at<TokenSys>();
      auto bob   = t.as(t.add_account("bob"_a));
      auto b     = bob.at<TokenSys>();

      auto tokenId = a.create(8, 1'000'000'000).returnVal();
      auto token   = a.getToken(tokenId).returnVal();

      THEN("Bob may not mint them")
      {
         auto mint = b.mint(tokenId, 1000, bob);
         CHECK(mint.failed(missingRequiredAuth));
      }
      THEN("Alice may not mint them with an invalid token ID")
      {
         // NOP
         CHECK(false);  // Unimplemented
      }
      THEN("Alice may not mint them to an invalid Account")
      {
         // NOP
         CHECK(false);  // Unimplemented
         // This and prior test case make me with there was a system for type-specific context-*aware* testing
         // Put the logic to ensure that an account is valid and a token is valid in one place
      }
      THEN("Alice may mint new tokens")
      {
         auto mint1 = a.mint(tokenId, 1000, alice);
         auto mint2 = a.mint(tokenId, 1000, bob);
         CHECK(mint1.succeeded());
         CHECK(mint2.succeeded());

         AND_THEN("The tokens were allocated accordingly")
         {
            auto getBalanceAlice = a.getBalance(tokenId);
            auto getBalanceBob   = b.getBalance(tokenId);

            CHECK(getBalanceAlice.succeeded());
            CHECK(getBalanceAlice.returnVal() == 1000);

            CHECK(getBalanceBob.succeeded());
            CHECK(getBalanceBob.returnVal() == 1000);
         }
      }
   }

   GIVEN("A token created by Alice with inflation limits")
   {
      THEN("Alice may not exceed those inflation limits") {}
      THEN("Alice may not raise those inflation limits") {}
   }
}

SCENARIO("Recalling tokens")
{
   GIVEN("Alice created a new token and issued some to Bob")
   {
      THEN("The token is recallable by default") {}
      THEN("Alice can recall Bob's tokens") {}
      THEN("The token issuer may turn off recallability") {}
      WHEN("The token issuer turns off recallability")
      {
         THEN("Alice may not recall Bob's tokens") {}
      }
   }
}

SCENARIO("Interactions with the Issuer NFT")
{
   GIVEN("Alice created and distributed a token")
   {
      WHEN("Alice transfers the issuer NFT to Bob")
      {
         THEN("The token record is identical") {}
         THEN("Bob may mint new tokens") {}
         THEN("Alice may not mint new tokens") {}
         THEN("Alice may not recall Bob's tokens") {}
         THEN("Bob may recall Alice's tokens") {}
      }
      WHEN("Alice burns the issuer NFT")
      {
         THEN("Alice may not mint new tokens") {}
         THEN("Alice may not transfer the issuer NFT") {}
         THEN("Alice may not recall Bob's tokens") {}
         THEN("Alice may not update the token inflation") {}
         THEN("Alice may not update the token recallability") {}
      }
   }
}

SCENARIO("Burning tokens")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      THEN("Alice may not burn 101 tokens") {}
      THEN("Alice may burn 60 tokens")
      {
         AND_THEN("Alice may not burn 41 more") {}
         AND_THEN("Alice may burn 40 more") {}
      }
      WHEN("Alice burns 60 tokens")
      {
         THEN("She still owns 40 tokens") {}
         THEN("Bob still owns 100 tokens") {}
      }
      WHEN("Alice burns 100 tokens")
      {
         THEN("Her balance is 0") {}
         THEN("She may not burn any more") {}
         THEN("Bob may burn tokens") {}
         AND_WHEN("Bob burns 10 tokens")
         {
            THEN("Bob still has 90 tokens") {}
            THEN("Alice still has 0 tokens") {}
         }
      }
   }
}

SCENARIO("Toggling auto-debit")
{
   GIVEN("A chain with users Alice and Bob")
   {
      THEN("Alice and Bob both have autodebit enabled") {}
      THEN("Alice may disable autodebit") {}
      WHEN("Alice disables autodebit")
      {
         THEN("Alice has autodebit disabled") {}
         THEN("Bob still has autodebit enabled") {}
         THEN("Alice may not disable autodebit again")
         {
            AND_THEN("But Bob may disable autodebit") {}
         }
         THEN("Alice may re-enable autodebit") {}
         WHEN("Alice re-enables autodebit"){}
         {
            THEN("Alice has autodebit enabled") {}
            THEN("Bob still has autodebit enabled") {}
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens, with auto-debit")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      THEN("Alice may not credit Bob 101 tokens") {}
      THEN("Alice may credit Bob 100 tokens") {}
      WHEN("Alice credits Bob 100 tokens")
      {
         THEN("Bob immediately has 200 tokens") {}
         THEN("Alice immediately has 0 tokens") {}
         THEN("Alice may not credit Bob 1 token") {}
         THEN("Bob may not debit any tokens") {}
         THEN("Alice may not uncredit any tokens") {}
         THEN("Bob may credit Alice 10 tokens") {}
         AND_WHEN("Bob credits Alice 10 tokens")
         {
            THEN("Bob has 190 tokens") {}
            THEN("Alice has 10 tokens") {}
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens, without auto-debit")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      AND_GIVEN("Alice turned off autodebit")
      {
         THEN("Alice may credit Bob 50 tokens") {}
         THEN("Bob may credit Alice 50 tokens") {}
         WHEN("Alice credits Bob 50 tokens")
         {
            THEN("Bob immediately owns 150 tokens") {}
            THEN("Alice immediately owns 50 tokens") {}
            THEN("Alice and Bob may not uncredit any tokens") {}
            THEN("Alice and Bob may not debit any tokens") {}
         }
         WHEN("Bob credits Alice 50 tokens")
         {
            THEN("Bob still owns the 100 tokens") {}
            THEN("Bob may not uncredit 51 tokens") {}
            THEN("Bob may uncredit 25 tokens")
            {
               AND_THEN("Bob may not uncredit 26 tokens") {}
               AND_THEN("Bob may uncredit 25 tokens") {}
               AND_THEN("Alice may not debit 26 tokens") {}
               AND_THEN("Alice may debit 25 tokens") {}
            }
            THEN("Alice may not debit 51 tokens") {}
            THEN("Alice may debit 50 tokens") {}
            AND_WHEN("Alice debits 50 tokens")
            {
               THEN("Alice owns 150 tokens") {}
               THEN("Bob owns 50 tokens") {}
               THEN("Alice may not debit any tokens") {}
               THEN("Bob may not uncredit any tokens") {}
               THEN("Bob may credit an additional 25 tokens") {}
            }
         }
      }
   }
}

SCENARIO("Interactions with symbols")
{
   INFO("Token symbols are not yet supported");
   CHECK(false);
}