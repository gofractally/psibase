#define CATCH_CONFIG_MAIN

#include "token_sys.hpp"

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using UserContract::TokenSys;

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

SCENARIO("Creating a token")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t({{TokenSys::contract, "token_sys.wasm"}});
      auto             alice = t.as(t.add_account("alice"_a));
      auto             bob   = t.as(t.add_account("bob"_a));

      auto a = alice.at<TokenSys>();

      THEN("Alice may create a token")
      {  //
         a.create(8, 1'000'000'000).succeeded();
      }
      THEN("Alice may not create a token with out of range precision or max_supply")
      {
         a.create(2e9, 1'000'000'000).succeeded();
      }
      WHEN("Alice creates a token")
      {
         THEN("The token exists") {}
         THEN("Alice may create a second token")
         {
            AND_THEN("The issuer NFT is different from the first token NFT") {}
         }
      }
   }
}

SCENARIO("Minting tokens")
{
   GIVEN("Alice created a token")
   {
      THEN("Alice may mint new tokens") {}
      THEN("Alice may not mint negative amounts of tokens") {}
      WHEN("Alice mints 100 tokens to herself")
      {
         THEN("She owns 100 tokens") {}
      }
      WHEN("Alice mints 100 tokens to Bob")
      {
         THEN("Bob owns 100 tokens") {}
      }
      THEN("Bob may not mint new tokens") {}
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