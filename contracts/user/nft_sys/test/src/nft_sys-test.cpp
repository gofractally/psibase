#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <catch2/catch.hpp>
#include <contracts/system/account_sys.hpp>
#include <contracts/system/test.hpp>
#include <string>

#include "nft_sys.hpp"

using namespace eosio;
using namespace UserContract;
using namespace psibase;
using std::optional;
using std::pair;
using std::string;
using std::vector;
using namespace UserContract::Errors;
using UserContract::NftRow;

namespace
{
   void configureTestChain(test_chain& t)
   {
      t.start_block();
      boot_minimal(t);
      auto cnum = add_contract(t, NftSys::contract, "nft_sys.wasm");
   }

   auto debugCounter = [i = 0]() mutable { std::cout << "\nTEST " << ++i << "\n\n"; };

}  // namespace

SCENARIO("Minting & burning nfts")
{
   GIVEN("An empty chain with registered users Alice and Bob")
   {
      test_chain t;
      configureTestChain(t);

      auto alice = t.as(add_account(t, "alice"));
      auto bob   = t.as(add_account(t, "bob"));

      auto a = alice.at<NftSys>();
      auto b = bob.at<NftSys>();

      THEN("Alice can mint an NFT")
      {
         auto mint = a.mint();
         CHECK(mint.succeeded());

         AND_THEN("The NFT exists")
         {
            NftRow expectedNft{
                .id              = 1,         // First minted NFT (skipping 0)
                .issuer          = alice.id,  //
                .owner           = alice.id,  //
                .approvedAccount = system_contract::account_sys::null_account  //
            };

            auto nft = a.getNft(mint.returnVal).returnVal;
            CHECK((nft != std::nullopt && (*nft) == expectedNft));
         }
      }
      THEN("Alice cannot force Bob to pay the storage cost for her minting an NFT")
      {
         CHECK(a.mint().failed("Missing required authority"));
      }
      WHEN("Alice mints an NFT")
      {
         auto mint = a.mint();
         auto nft1 = *(a.getNft(mint.returnVal).returnVal);

         t.start_block();
         THEN("Alice consumes storage space as expected")
         {
            CHECK(mint.diskConsumed({{alice.id, NftRow::DiskUsage::firstEmplace}}));
         }
         THEN("Alice can burn the NFT")
         {  //
            CHECK(a.burn(nft1.id).succeeded());
         }
         THEN("Bob cannot burn the NFT")
         {  //
            CHECK(b.burn(nft1.id).failed(missingRequiredAuth));
         }
         AND_WHEN("Alice mints a second NFT")
         {
            auto mint2 = a.mint();
            t.start_block();

            THEN("The NFT is identical in every way, except the ID is incremented")
            {
               auto nft2 = *(a.getNft(mint2.returnVal).returnVal);

               NftRow expectedNft = nft1;
               expectedNft.id++;
               REQUIRE(nft2 == expectedNft);
            }
         }
         AND_WHEN("Bob mints an NFT")
         {
            auto mint = b.mint();
            t.start_block();

            THEN("Bob's pays for an expected amount of storage space")
            {
               CHECK(mint.diskConsumed({{bob.id, NftRow::DiskUsage::subsequentEmplace}}));
            }
         }
      }
   }
}

//       - Add test cases for checking that events were emitted properly
SCENARIO("Transferring NFTs")
{
   GIVEN("A chain with registered users Alice, Bob, and Charlie")
   {
      test_chain t;
      configureTestChain(t);

      auto alice   = t.as(add_account(t, "alice"));
      auto bob     = t.as(add_account(t, "bob"));
      auto charlie = t.as(add_account(t, "charlie"));

      auto a = alice.at<NftSys>();
      auto b = bob.at<NftSys>();
      auto c = charlie.at<NftSys>();

      THEN("Bob is configured to use auto-debit by default")
      {
         auto isAutodebit = b.isAutodebit();

         CHECK(isAutodebit.succeeded());
         CHECK(true == isAutodebit.returnVal);
      }
      THEN("Bob is able to opt out of auto-debit")
      {
         bool isAutodebit = b.isAutodebit().returnVal;
         CHECK(isAutodebit);

         auto autodebit = b.autodebit(false);
         CHECK(autodebit.succeeded());

         isAutodebit = b.isAutodebit().returnVal;
         CHECK(!isAutodebit);
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         CHECK(a.credit(bob, 1, "memo").failed(nftDNE));
         CHECK(a.uncredit(bob, 1).failed(nftDNE));
         CHECK(a.debit(bob, 1).failed(nftDNE));
         CHECK(a.debit(bob, 1).failed(nftDNE));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         auto mint = a.mint();
         auto nft  = *(a.getNft(mint.returnVal).returnVal);

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(b.debit(alice, nft.id).failed(debitRequiresCredit));
            CHECK(b.uncredit(alice, nft.id).failed(uncreditRequiresCredit));
            CHECK(a.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
         }

         THEN("Bob may not credit the NFT to Bob")
         {
            CHECK(b.credit(alice, nft.id, "memo").failed(missingRequiredAuth));
         }
         THEN("Alice may not credit the NFT to herself")
         {
            CHECK(a.credit(alice, nft.id, "memo").failed(creditorIsDebitor));
         }
         THEN("Alice may credit the NFT to Bob")
         {
            CHECK(a.credit(bob, nft.id, "memo").succeeded());
         }
         WHEN("Alice credits the NFT to Bob")
         {
            auto credit = a.credit(bob, nft.id, "memo");

            THEN("Bob immediately owns the NFT")
            {
               auto newNft = *(b.getNft(nft.id).returnVal);
               CHECK(newNft.owner == bob.id);
            }
            THEN("The payer for storage costs of the NFT are updated accordingly")
            {
               CHECK(credit.diskConsumed({{alice.id, -1 * NftRow::DiskUsage::update},
                                          {bob.id, NftRow::DiskUsage::update}}));
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(a.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
            }
         }
         WHEN("Bob opts out of auto-debit")
         {
            b.autodebit(false);

            AND_WHEN("Alice credits the NFT to Bob")
            {
               auto credit = a.credit(bob, nft.id, "memo");

               THEN("The NFT is not yet owned by Bob")
               {
                  CHECK(bob.id != b.getNft(nft.id).returnVal->owner);
               }
               THEN("The payer for storage costs of the NFT do not change")
               {
                  CHECK(credit.diskConsumed({{}}));
               }
               THEN("Alice and Charlie may not debit the NFT")
               {
                  CHECK(a.debit(bob, nft.id).failed(creditorIsDebitor));
                  CHECK(a.debit(bob, nft.id).failed(missingRequiredAuth));
               }
               THEN("Bob and Charlie may not uncredit the NFT")
               {
                  CHECK(b.uncredit(alice, nft.id).failed(creditorAction));
                  CHECK(c.uncredit(alice, nft.id).failed(creditorAction));
               }
               THEN("Bob may debit the NFT")
               {
                  auto debit = b.debit(alice, nft.id);
                  CHECK(debit.succeeded());
                  AND_THEN("The payer for storage costs of the NFT are updated accordingly")
                  {
                     debit.diskConsumed({{alice.id, -1 * NftRow::DiskUsage::update},
                                         {bob.id, NftRow::DiskUsage::update}});
                  }
               }
               THEN("Alice may uncredit the NFT")
               {
                  auto uncredit = a.uncredit(bob, nft.id);
                  CHECK(uncredit.succeeded());

                  AND_THEN("The payer for storage costs of the NFT do not change")
                  {
                     CHECK(uncredit.diskConsumed({{}}));
                  }
               }
               AND_WHEN("Bob debits the NFT")
               {
                  auto debit = b.debit(alice, nft.id);

                  THEN("Bob owns the NFT") { CHECK(bob.id == b.getNft(nft.id).returnVal->owner); }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(a.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
                     CHECK(a.debit(bob, nft.id).failed(debitRequiresCredit));
                     CHECK(c.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
                     CHECK(c.debit(bob, nft.id).failed(debitRequiresCredit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(b.debit(alice, nft.id).failed(debitRequiresCredit));
                  }
               }
               AND_WHEN("Alice uncredits the NFT")
               {
                  a.uncredit(bob, nft.id);

                  THEN("No one can debit or uncredit the NFT")
                  {
                     CHECK(a.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
                     CHECK(b.uncredit(bob, nft.id).failed(uncreditRequiresCredit));
                     CHECK(c.uncredit(bob, nft.id).failed(uncreditRequiresCredit));

                     CHECK(a.debit(bob, nft.id).failed(debitRequiresCredit));
                     CHECK(b.debit(bob, nft.id).failed(debitRequiresCredit));
                     CHECK(c.debit(bob, nft.id).failed(debitRequiresCredit));
                  }
                  THEN("Alice may credit the NFT again")
                  {
                     CHECK(a.credit(bob, nft.id, "memo").succeeded());
                  }
               }
            }
         }
      }
   }
}

SCENARIO("Approving NFTs")
{
   // Approving NFTs allows someone to credit the NFT on your behalf.
}