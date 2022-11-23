#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/print.hpp>
#include <psibase/testUtils.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/RTokenSys.hpp>
#include <services/user/TokenSys.hpp>

#include "services/user/SymbolSys.hpp"

using namespace psibase;
using namespace psibase::benchmarking;
using UserService::TokenSys;
using namespace UserService::Errors;
using namespace UserService;

namespace
{
   constexpr bool inflationLimitsImplemented    = false;
   constexpr bool eventEmissionTestingSupported = false;
   constexpr bool customTokensSupported         = false;

   struct DiskUsage_TokenRecord
   {
      static constexpr int64_t firstEmplace      = 100;
      static constexpr int64_t subsequentEmplace = 100;
      static constexpr int64_t update            = 100;
   };

   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededServices = {
       {TokenSys::service, "TokenSys.wasm"},
       {NftSys::service, "NftSys.wasm"},
       {SymbolSys::service, "SymbolSys.wasm"}};

   constexpr auto manualDebit  = "manualDebit"_m;
   constexpr auto unrecallable = "unrecallable"_m;
   constexpr auto untradeable  = "untradeable"_m;

}  // namespace

SCENARIO("Using system token")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto sysIssuer   = t.from(SymbolSys::service).to<TokenSys>();
      auto userBalance = 1'000'000e8;
      auto sysToken    = TokenSys::sysToken;
      sysIssuer.mint(sysToken, userBalance, memo);

      THEN("The system token is untradeable by default")
      {
         auto isUntradeable = a.getTokenConf(sysToken, untradeable);
         CHECK(isUntradeable.succeeded());
         CHECK(isUntradeable.returnVal() == true);
      }
      THEN("The system token issuer is able to credit the system token")
      {
         CHECK(sysIssuer.credit(sysToken, alice, userBalance, memo).succeeded());
      }
      sysIssuer.credit(sysToken, alice, userBalance, memo);

      THEN("Alice cannot credit system tokens to anyone")
      {
         CHECK(a.credit(sysToken, bob, userBalance / 2, memo).failed(tokenUntradeable));
      }

      THEN("The issuer is able to make the token tradeable")
      {
         CHECK(sysIssuer.setTokenConf(sysToken, untradeable, false).succeeded());

         AND_THEN("Alice may credit system tokens to anyone")
         {
            CHECK(a.credit(sysToken, bob, userBalance / 2, memo).succeeded());
         }
         AND_THEN("Alice may not credit the system token to herself")
         {
            CHECK(a.credit(sysToken, alice, userBalance / 2, memo).failed(senderIsReceiver));
         }
      }
   }
}

SCENARIO("Creating a token")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      THEN("Alice may create a token")
      {
         auto create = a.create(8, 1'000'000'000e8);
         CHECK(create.succeeded());

         AND_THEN("The token exists")
         {
            auto tokenId = create.returnVal();
            CHECK(a.getToken(tokenId).succeeded());
            AND_THEN("The tokenId is not 0")
            {  //
               CHECK(tokenId != 0);
            }
         }
      }
      THEN("Alice may not create a token with invalid precision")
      {
         Quantity  q{100e8};
         Precision p0{0};
         Precision p1{16};
         Precision p2{17};

         CHECK(a.create(p0, q).succeeded());
         CHECK(a.create(p1, q).succeeded());
         CHECK(a.create(p2, q).failed(Precision::errorInvalid));
      }
      THEN("Alice may not create a token with invalid quantity")
      {
         Precision p{4};
         Quantity  q0{0e8};
         Quantity  q1{1e8};
         Quantity  q2{2e8};
         Quantity  q3{std::numeric_limits<Quantity::Quantity_t>::max()};
         CHECK(a.create(p, q0).failed(Errors::supplyGt0));
         CHECK(a.create(p, q1).succeeded());
         CHECK(a.create(p, q2).succeeded());
         CHECK(a.create(p, q3).succeeded());
      }
      WHEN("Alice creates a token")
      {
         auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
         auto token1  = a.getToken(tokenId).returnVal();

         THEN("Alice may create a second token")
         {
            t.startBlock();

            auto create = a.create(8, 1'000'000'000e8);
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
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();

      THEN("Bob may not mint them")
      {
         auto mint = b.mint(tokenId, 1'000e8, memo);
         CHECK(mint.failed(missingRequiredAuth));
      }
      THEN("Alice may not mint them with a nonexistent token ID")
      {
         auto mint = a.mint(999, 1'000e8, memo);
         CHECK(mint.failed(tokenDNE));
      }
      THEN("Alice may not mint more tokens than are allowed by the specified max supply")
      {
         CHECK(a.mint(tokenId, 1'000'000'001e8, memo).failed(maxSupplyExceeded));
      }
      THEN("Alice may mint new tokens")
      {
         Quantity quantity{1'000e8};
         auto     mint = a.mint(tokenId, quantity, memo);
         CHECK(mint.succeeded());

         AND_THEN("The tokens were allocated accordingly")
         {
            auto getBalance = a.getBalance(tokenId, alice);
            CHECK(getBalance.succeeded());
            CHECK(getBalance.returnVal().balance == quantity);
         }
      }
   }

   GIVEN("A token created by Alice with inflation limits")
   {
      //CHECK(inflationLimitsImplemented);

      THEN("Alice may not exceed those inflation limits")
      {  //
         //CHECK(inflationLimitsImplemented);
      }
      THEN("Alice may not raise those inflation limits")
      {  //
         //CHECK(inflationLimitsImplemented);
      }
   }
}

SCENARIO("Recalling tokens")
{
   GIVEN("Alice created a new token and issued some to Bob")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      a.mint(tokenId, 1'000e8, memo);
      a.credit(tokenId, bob, 1'000e8, memo);

      THEN("The token is recallable by default")
      {
         auto unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);
         CHECK(false == token.config.get(unrecallableBit));
      }
      THEN("Alice can recall Bob's tokens")
      {
         auto recall = a.recall(tokenId, bob, 1'000e8, memo);
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
         CHECK(a.setTokenConf(tokenId, unrecallable, true).succeeded());

         t.startBlock();
         uint8_t unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);
         CHECK(a.getToken(tokenId).returnVal().config.get(unrecallableBit));

         AND_THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, 1'000e8, memo).failed(tokenUnrecallable));
         }
         AND_THEN("The token issuer may not re-enable recallability")
         {
            CHECK(a.setTokenConf(tokenId, unrecallable, false).failed(invalidConfigUpdate));
         }
      }
   }
}

SCENARIO("Interactions with the Issuer NFT")
{
   GIVEN("Alice created and distributed a token")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto nft     = alice.to<NftSys>().getNft(token.ownerNft).returnVal();
      t.startBlock();

      THEN("The Issuer NFT is owned by Alice")
      {
         CHECK(nft.owner == alice.id);
      }
      WHEN("Alice credits the issuer NFT to Bob")
      {
         alice.to<NftSys>().credit(nft.id, bob, memo);

         THEN("The NFT is owned by Bob")
         {
            auto newNft = alice.to<NftSys>().getNft(token.ownerNft).returnVal();
            nft.owner   = bob.id;
            CHECK((newNft.id == nft.id && newNft.issuer == nft.issuer  //
                   && newNft.owner == nft.owner));
            // Todo - Use simple comparison once eventHeadId moves out of Nft record.
         }
         THEN("The token record is identical")
         {  //
            CHECK(a.getToken(tokenId).returnVal() == token);
         }
         THEN("Bob may mint new tokens")
         {  //
            CHECK(b.mint(tokenId, 1'000e8, memo).succeeded());
         }
         THEN("Alice may not mint new tokens")
         {
            CHECK(a.mint(tokenId, 1'000e8, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not recall Bob's tokens")
         {
            b.mint(tokenId, 1'000e8, memo);
            CHECK(a.recall(tokenId, bob, 1'000e8, memo).failed(missingRequiredAuth));
         }
         THEN("Bob may recall Alice's tokens")
         {
            Quantity q{1'000e8};
            b.mint(tokenId, q, memo);
            b.credit(tokenId, alice, q, memo);
            CHECK(b.recall(tokenId, alice, q, memo).succeeded());
         }
      }
      WHEN("Alice burns the issuer NFT")
      {
         Quantity quantity{1'000e8};
         a.mint(tokenId, quantity, memo);
         a.credit(tokenId, bob, quantity, memo);
         alice.to<NftSys>().burn(nft.id);
         t.startBlock();

         THEN("Alice may not mint new tokens")
         {
            CHECK(a.mint(tokenId, quantity, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not credit the issuer NFT to anyone")
         {
            CHECK(alice.to<NftSys>().credit(nft.id, bob, memo).failed(nftDNE));
         }
         THEN("Alice may not recall Bob's tokens")
         {
            CHECK(a.recall(tokenId, bob, quantity, memo).failed(missingRequiredAuth));
         }
         THEN("Alice may not update the token inflation")
         {  //
            // CHECK(inflationLimitsImplemented);
         }
         THEN("Alice may not update the token recallability")
         {
            CHECK(a.setTokenConf(tokenId, unrecallable, true).failed(missingRequiredAuth));
         }
      }
   }
}

SCENARIO("Burning tokens")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto mint    = a.mint(tokenId, 200e8, memo);
      a.credit(tokenId, bob, 100e8, memo);

      THEN("Alice may not burn 101 tokens")
      {
         CHECK(a.burn(tokenId, 101e8).failed(insufficientBalance));
      }
      THEN("Alice may burn 60 tokens")
      {
         CHECK(a.burn(tokenId, 60e8).succeeded());

         AND_THEN("Alice may not burn 41 more")
         {
            CHECK(a.burn(tokenId, 41e8).failed(insufficientBalance));
         }
         AND_THEN("Alice may burn 40 more")
         {  //
            CHECK(a.burn(tokenId, 40e8).succeeded());
         }
      }
      WHEN("Alice burns 60 tokens")
      {
         a.burn(tokenId, 60e8);

         THEN("She still owns 40 tokens")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 40e8);
         }
         THEN("Bob still owns 100 tokens")
         {  //
            CHECK(b.getBalance(tokenId, bob).returnVal().balance == 100e8);
         }
      }
      WHEN("Alice burns 100 tokens")
      {
         a.burn(tokenId, 100e8);

         THEN("Her balance is 0")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0e8);
         }
         THEN("She may not burn any more")
         {
            CHECK(a.burn(tokenId, 1e8).failed(insufficientBalance));
         }
         THEN("Bob may burn tokens")
         {  //
            CHECK(b.burn(tokenId, 10e8).succeeded());
         }
         AND_WHEN("Bob burns 10 tokens")
         {
            b.burn(tokenId, 10e8);

            THEN("Bob still has 90 tokens")
            {  //
               CHECK(b.getBalance(tokenId, bob).returnVal().balance == 90e8);
            }
            THEN("Alice still has 0 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0e8);
            }
         }
      }
   }
}

SCENARIO("Toggling manual-debit")
{
   GIVEN("A chain with users Alice and Bob")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      THEN("Alice and Bob both have manualDebit disabled")
      {
         auto isManualDebit1 = a.getUserConf(alice, manualDebit);
         REQUIRE(isManualDebit1.succeeded());
         CHECK(isManualDebit1.returnVal() == false);

         auto isManualDebit2 = a.getUserConf(bob, manualDebit);
         REQUIRE(isManualDebit2.succeeded());
         CHECK(isManualDebit2.returnVal() == false);
      }
      THEN("Alice may enable manual-debit")
      {  //
         CHECK(a.setUserConf(manualDebit, true).succeeded());
      }
      WHEN("Alice enabled manual-debit")
      {
         a.setUserConf(manualDebit, true);
         t.startBlock();

         THEN("Alice has manual-debit enabled")
         {  //
            CHECK(a.getUserConf(alice, manualDebit).returnVal() == true);
         }
         THEN("Bob still has manual-debit disabled")
         {  //
            CHECK(a.getUserConf(bob, manualDebit).returnVal() == false);
         }
         THEN("Alice may not enable manual-debit again")
         {
            CHECK(a.setUserConf(manualDebit, true).failed(redundantUpdate));

            AND_THEN("But Bob may enable manual-debit")
            {  //
               CHECK(b.setUserConf(manualDebit, true).succeeded());
            }
         }
         THEN("Alice may disable manual-debit")
         {  //
            CHECK(a.setUserConf(manualDebit, false).succeeded());

            AND_THEN("Alice has manual-debit disabled")
            {  //
               CHECK(a.getUserConf(alice, manualDebit).returnVal() == false);
            }
            AND_THEN("Bob still has manual-debit disabled")
            {
               CHECK(a.getUserConf(bob, manualDebit).returnVal() == false);
            }
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
      auto token   = a.getToken(tokenId).returnVal();
      auto mint    = a.mint(tokenId, 200e8, memo);
      a.credit(tokenId, bob, 100e8, memo);

      THEN("Alice may not credit Bob 101 tokens")
      {
         t.startBlock();
         CHECK(a.credit(tokenId, bob, 101e8, memo).failed(insufficientBalance));
      }
      THEN("Alice may credit Bob 100 tokens")
      {
         t.startBlock();
         CHECK(a.credit(tokenId, bob, 100e8, memo).succeeded());
      }
      WHEN("Alice credits Bob 100 tokens")
      {
         t.startBlock();
         a.credit(tokenId, bob, 100e8, memo);

         THEN("Bob immediately has 200 tokens")
         {  //
            CHECK(b.getBalance(tokenId, bob).returnVal().balance == 200e8);
         }
         THEN("Alice immediately has 0 tokens")
         {  //
            CHECK(a.getBalance(tokenId, alice).returnVal().balance == 0e8);
         }
         THEN("Alice may not credit Bob 1 token")
         {
            CHECK(a.credit(tokenId, bob, 1e8, memo).failed(insufficientBalance));
         }
         THEN("Bob may not debit any tokens")
         {
            CHECK(b.debit(tokenId, alice, 1e8, memo).failed(insufficientBalance));
         }
         THEN("Alice may not uncredit any tokens")
         {
            CHECK(a.uncredit(tokenId, bob, 1e8, memo).failed(insufficientBalance));
         }
         THEN("Bob may credit Alice 10 tokens")
         {
            CHECK(b.credit(tokenId, alice, 10e8, memo).succeeded());
         }
         AND_WHEN("Bob credits Alice 10 tokens")
         {
            b.credit(tokenId, alice, 10e8, memo);

            THEN("Bob has 190 tokens")
            {  //
               CHECK(b.getBalance(tokenId, bob).returnVal().balance == 190e8);
            }
            THEN("Alice has 10 tokens")
            {  //
               CHECK(a.getBalance(tokenId, alice).returnVal().balance == 10e8);
            }
         }
      }
   }
}

SCENARIO("Crediting/uncrediting/debiting tokens, with manual-debit")
{
   GIVEN("A chain with users Alice and Bob, who each own 100 tokens")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto a     = alice.to<TokenSys>();
      auto bob   = t.from(t.add_account("bob"_a));
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      auto tokenId = a.create(8, 1'000'000'000e8).returnVal();
      auto token   = a.getToken(tokenId).returnVal();

      a.mint(tokenId, 200e8, memo);
      a.credit(tokenId, bob, 100e8, memo);

      AND_GIVEN("Alice turns on manual-debit")
      {
         a.setUserConf(manualDebit, true);

         THEN("Alice may credit Bob 50 tokens")
         {
            CHECK(a.credit(tokenId, bob, 50e8, memo).succeeded());
         }
         THEN("Bob may credit Alice 50 tokens")
         {
            CHECK(b.credit(tokenId, alice, 50e8, memo).succeeded());
         }
         WHEN("Alice credits Bob 50 tokens")
         {
            a.credit(tokenId, bob, 50e8, memo);

            THEN("The transfer happens immediately")
            {
               CHECK(150e8 == b.getBalance(tokenId, bob).returnVal().balance);
               CHECK(50e8 == a.getBalance(tokenId, alice).returnVal().balance);
            }
            THEN("Alice and Bob may not uncredit any tokens")
            {
               CHECK(a.uncredit(tokenId, bob, 50e8, memo).failed(insufficientBalance));
               CHECK(b.uncredit(tokenId, alice, 50e8, memo).failed(insufficientBalance));
            }
            THEN("Alice and Bob may not debit any tokens")
            {
               CHECK(a.debit(tokenId, bob, 50e8, memo).failed(insufficientBalance));
               CHECK(b.debit(tokenId, alice, 50e8, memo).failed(insufficientBalance));
            }
         }
         WHEN("Bob credits Alice 50 tokens")
         {
            b.credit(tokenId, alice, 50e8, memo);

            THEN("Bob owns 50 tokens in his individual balance")
            {
               CHECK(50e8 == b.getBalance(tokenId, bob).returnVal().balance);
               AND_THEN("Bob owns 50 tokens in his shared balance with Alice")
               {
                  CHECK(50e8 == b.getSharedBal(tokenId, bob, alice).returnVal().balance);
               }
            }
            THEN("Bob may try to uncredit 51 tokens, but will only uncredit 50")
            {
               CHECK(50e8 == b.getBalance(tokenId, bob).returnVal().balance);
               CHECK(b.uncredit(tokenId, alice, 51e8, memo).succeeded());
               t.startBlock();
               CHECK(100e8 == b.getBalance(tokenId, bob).returnVal().balance);
            }
            THEN("Bob may uncredit 25 tokens")
            {
               CHECK(b.uncredit(tokenId, alice, 25e8, memo).succeeded());

               AND_THEN("Bob may uncredit 25 tokens")
               {
                  t.startBlock();
                  CHECK(b.uncredit(tokenId, alice, 25e8, memo).succeeded());
                  AND_THEN("Bob owns 0 tokens in his shared balance with Alice")
                  {
                     CHECK(0e8 == b.getSharedBal(tokenId, bob, alice).returnVal().balance);

                     AND_THEN("Bob may not uncredit any tokens")
                     {
                        CHECK(b.uncredit(tokenId, alice, 1e8, memo).failed(insufficientBalance));
                     }
                  }
               }
               AND_THEN("Alice may not debit 26 tokens")
               {
                  CHECK(a.debit(tokenId, bob, 26e8, memo).failed(insufficientBalance));
               }
               AND_THEN("Alice may debit 25 tokens")
               {
                  CHECK(a.debit(tokenId, bob, 25e8, memo).succeeded());
                  AND_THEN("Bob has 0 tokens in his shared balance with Alice")
                  {
                     CHECK(0e8 == b.getSharedBal(tokenId, bob, alice).returnVal().balance);
                  }
                  AND_THEN("Bob owns 75 tokens in his individual balance")
                  {
                     CHECK(75e8 == b.getBalance(tokenId, bob).returnVal().balance);
                  }
                  AND_THEN("Alice owns 125 tokens in her individual balance")
                  {
                     CHECK(125e8 == a.getBalance(tokenId, alice).returnVal().balance);
                  }
               }
            }
            THEN("Alice may not debit 51 tokens")
            {
               CHECK(a.debit(tokenId, bob, 51e8, memo).failed(insufficientBalance));
            }
            THEN("Alice may debit 50 tokens")
            {
               CHECK(a.debit(tokenId, bob, 50e8, memo).succeeded());
               AND_THEN("Alice may not debit any more tokens")
               {
                  CHECK(a.debit(tokenId, bob, 1e8, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may not uncredit any more tokens")
               {
                  CHECK(b.uncredit(tokenId, alice, 1e8, memo).failed(insufficientBalance));
               }
               AND_THEN("Bob may credit an additional 25 tokens")
               {
                  CHECK(b.credit(tokenId, alice, 25e8, memo).succeeded());
               }
            }
         }
      }
   }
}

SCENARIO("Mapping a symbol to a token")
{
   GIVEN("Alice has created a token and created a symbol")
   {
      DefaultTestChain t(neededServices);

      auto alice = t.from(t.add_account("alice"_a));
      auto bob   = t.from(t.add_account("bob"_a));
      auto a     = alice.to<TokenSys>();
      auto b     = bob.to<TokenSys>();

      // Initialize user services
      alice.to<NftSys>().init();
      alice.to<TokenSys>().init();
      alice.to<SymbolSys>().init();

      // Issue system tokens
      auto sysIssuer   = t.from(SymbolSys::service).to<TokenSys>();
      auto userBalance = 1'000'000e8;
      auto sysToken    = TokenSys::sysToken;
      sysIssuer.setTokenConf(sysToken, untradeable, false);
      sysIssuer.mint(sysToken, userBalance, memo);
      sysIssuer.credit(sysToken, alice, userBalance, memo);

      // Mint a second token
      t.startBlock();
      auto newToken = a.create(8, userBalance).returnVal();
      a.mint(newToken, userBalance, memo);

      // Purchase the symbol and claim the owner NFT
      auto symbolCost = alice.to<SymbolSys>().getPrice(3).returnVal();
      a.credit(sysToken, SymbolSys::service, symbolCost, memo);
      auto symbolId     = "abc"_a;
      auto create       = alice.to<SymbolSys>().create(symbolId, symbolCost);
      auto symbolRecord = alice.to<SymbolSys>().getSymbol(symbolId).returnVal();
      auto nftId        = symbolRecord.ownerNft;

      THEN("Bob is unable to map the symbol to the token")
      {
         CHECK(b.mapSymbol(newToken, symbolId).failed(missingRequiredAuth));
      }
      WHEN("Alice burns the symbol owner NFT")
      {
         alice.to<NftSys>().burn(nftId);

         THEN("Alice is unable to map the symbol to the token")
         {
            CHECK(a.mapSymbol(newToken, symbolId).failed(missingRequiredAuth));
         }
      }
      WHEN("Alice burns the token owner NFT")
      {
         auto tokenNft = a.getToken(newToken).returnVal().ownerNft;
         alice.to<NftSys>().burn(tokenNft);

         THEN("Alice is unable to map the symbol to the token")
         {
            CHECK(a.mapSymbol(newToken, symbolId).failed(missingRequiredAuth));
         }
      }
      THEN("Alice is unable to map a symbol to a nonexistent token")
      {
         TID invalidTokenId = 999;
         CHECK(a.mapSymbol(invalidTokenId, symbolId).failed(tokenDNE));
      }
      THEN("Alice is unable to map a nonexistent symbol to a token")
      {
         SID invalidSymbolId = "zzz"_a;
         CHECK(a.mapSymbol(newToken, invalidSymbolId).failed(symbolDNE));
      }
      THEN("Alice is able to map the symbol to the token")
      {
         alice.to<NftSys>().credit(nftId, TokenSys::service, memo);
         CHECK(a.mapSymbol(newToken, symbolId).succeeded());

         AND_THEN("The token ID mapping exists")
         {
            CHECK(a.getTokenSymbol(newToken).returnVal() == symbolId);
         }
      }
      WHEN("Alice maps the symbol to the token")
      {
         t.startBlock();
         alice.to<NftSys>().credit(nftId, TokenSys::service, memo);
         a.mapSymbol(newToken, symbolId);

         THEN("The symbol record is identical")
         {
            auto symbolRecord2 = alice.to<SymbolSys>().getSymbol(symbolId).returnVal();
            CHECK(symbolRecord == symbolRecord2);
         }

         THEN("Alice may not map a new symbol to the same token")
         {
            a.credit(sysToken, SymbolSys::service, symbolCost, memo);
            auto newSymbol = "bcd"_a;
            alice.to<SymbolSys>().create(newSymbol, symbolCost);
            auto newNft = alice.to<SymbolSys>().getSymbol(newSymbol).returnVal().ownerNft;

            alice.to<NftSys>().credit(newNft, TokenSys::service, memo);
            CHECK(a.mapSymbol(newToken, newSymbol).failed(tokenHasSymbol));
         }
      }
   }
}

TEST_CASE("Reading emitted events")
{
   //CHECK(eventEmissionTestingSupported);
}

TEST_CASE("Testing custom tokens")
{
   // Test a custom token service that uses the main token service
   //    hooks to customize distribution or other behavior.
   //CHECK(customTokensSupported);

   GIVEN("A custom token service")
   {
      THEN("It can't register with the main token service without the token owner NFT") {}
      THEN("It can register with the token service if it does own the token owner NFT")
      {
         AND_THEN("Storage costs are updated accordingly") {}
      }
      WHEN("It registers with the main token service")
      {  //
         // Verify that all the various hooks can be called.
      }
   }
}
