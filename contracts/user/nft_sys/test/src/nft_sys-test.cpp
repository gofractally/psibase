#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

#include <contracts/system/account_sys.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psio/fracpack.hpp>
#include <string>

#include "nft_sys.hpp"

using namespace UserContract;
using namespace UserContract::Errors;
using namespace psibase;
using std::optional;
using std::pair;
using std::string;
using std::vector;
using UserContract::NftRecord;

namespace
{
   constexpr bool storageBillingImplemented = false;
}

SCENARIO("Minting & burning nfts")
{
   GIVEN("An empty chain with registered users Alice and Bob")
   {
      DefaultTestChain t({{NftSys::contract, "nft_sys.wasm"}});

      auto alice = t.as(t.add_account("alice"_a));
      auto bob   = t.as(t.add_account("bob"_a));

      auto a = alice.at<NftSys>();
      auto b = bob.at<NftSys>();

      THEN("Alice can mint an NFT")
      {
         auto mint = a.mint();
         CHECK(mint.succeeded());

         AND_THEN("The NFT exists")
         {
            NftRecord expectedNft{
                .id         = 1,         // First minted NFT (skipping 0)
                .issuer     = alice.id,  //
                .owner      = alice.id,  //
                .creditedTo = system_contract::account_sys::null_account  //
            };

            auto nft = a.getNft(mint.returnVal()).returnVal();
            CHECK((nft != std::nullopt && (*nft) == expectedNft));
         }
      }
      WHEN("Alice mints an NFT")
      {
         auto mint = a.mint();
         auto nft1 = *(a.getNft(mint.returnVal()).returnVal());

         t.start_block();
         THEN("Alice consumes storage space as expected")
         {
            CHECK(mint.diskConsumed({{alice.id, NftRecord::DiskUsage::firstEmplace}}));
            CHECK(storageBillingImplemented);
         }
         THEN("Alice can burn the NFT")
         {  //
            CHECK(a.burn(nft1.id).succeeded());
         }
         THEN("Alice cannot burn a nonexistent NFT")
         {  //
            CHECK(a.burn(99).failed(nftDNE));
         }
         THEN("Bob cannot burn the NFT")
         {  //
            CHECK(b.burn(nft1.id).failed(missingRequiredAuth));
         }
         AND_WHEN("Alice burns the NFT")
         {
            a.burn(nft1.id);

            THEN("The NFT no longer exists")
            {  //
               CHECK(a.getNft(nft1.id).returnVal() != std::nullopt);
            }
         }
         AND_WHEN("Alice mints a second NFT")
         {
            auto mint2 = a.mint();
            t.start_block();

            THEN("The NFT is identical in every way, except the ID is incremented")
            {
               auto      nft2        = *(a.getNft(mint2.returnVal()).returnVal());
               NftRecord expectedNft = nft1;
               expectedNft.id++;
               CHECK(nft2 == expectedNft);
            }
         }
         AND_WHEN("Bob mints an NFT")
         {
            auto mint = b.mint();
            t.start_block();

            THEN("Bob's pays for an expected amount of storage space")
            {
               CHECK(mint.diskConsumed({{bob.id, NftRecord::DiskUsage::subsequentEmplace}}));
               CHECK(storageBillingImplemented);
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
      DefaultTestChain t({{NftSys::contract, "nft_sys.wasm"}});

      auto alice   = t.as(t.add_account("alice"));
      auto bob     = t.as(t.add_account("bob"));
      auto charlie = t.as(t.add_account("charlie"));

      auto a = alice.at<NftSys>();
      auto b = bob.at<NftSys>();
      auto c = charlie.at<NftSys>();

      THEN("Bob is configured to use auto-debit by default")
      {
         auto isAutodebit = b.isAutodebit();

         CHECK(isAutodebit.succeeded());
         CHECK(true == isAutodebit.returnVal());
      }
      THEN("Bob is able to opt out of auto-debit")
      {
         bool isAutodebit = b.isAutodebit().returnVal();
         CHECK(isAutodebit);

         auto autodebit = b.autodebit(false);
         CHECK(autodebit.succeeded());

         isAutodebit = b.isAutodebit().returnVal();
         CHECK(!isAutodebit);
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         CHECK(a.credit(bob, 1, "memo").failed(nftDNE));
         CHECK(a.uncredit(1).failed(nftDNE));
         CHECK(a.debit(1).failed(nftDNE));
         CHECK(a.debit(1).failed(nftDNE));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         auto mint = a.mint();
         auto nft  = *(a.getNft(mint.returnVal()).returnVal());

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(b.debit(nft.id).failed(debitRequiresCredit));
            CHECK(b.uncredit(nft.id).failed(uncreditRequiresCredit));
            CHECK(a.uncredit(nft.id).failed(uncreditRequiresCredit));
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
               auto newNft = *(b.getNft(nft.id).returnVal());
               CHECK(newNft.owner == bob.id);
            }
            THEN("The payer for storage costs of the NFT are updated accordingly")
            {
               CHECK(credit.diskConsumed({{alice.id, -1 * NftRecord::DiskUsage::update},
                                          {bob.id, NftRecord::DiskUsage::update}}));
               CHECK(storageBillingImplemented);
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(a.uncredit(nft.id).failed(uncreditRequiresCredit));
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
                  CHECK(bob.id != b.getNft(nft.id).returnVal()->owner);
               }
               THEN("The payer for storage costs of the NFT do not change")
               {
                  CHECK(credit.diskConsumed({{}}));
               }
               THEN("Alice and Charlie may not debit the NFT")
               {
                  CHECK(a.debit(nft.id).failed(debitRequiresCredit));
                  CHECK(c.debit(nft.id).failed(debitRequiresCredit));
               }
               THEN("Bob and Charlie may not uncredit the NFT")
               {
                  CHECK(b.uncredit(nft.id).failed(creditorAction));
                  CHECK(c.uncredit(nft.id).failed(creditorAction));
               }
               THEN("Bob may debit the NFT")
               {
                  auto debit = b.debit(nft.id);
                  CHECK(debit.succeeded());
                  AND_THEN("The payer for storage costs of the NFT are updated accordingly")
                  {
                     debit.diskConsumed({{alice.id, -1 * NftRecord::DiskUsage::update},
                                         {bob.id, NftRecord::DiskUsage::update}});
                  }
               }
               THEN("Alice may uncredit the NFT")
               {
                  auto uncredit = a.uncredit(nft.id);
                  CHECK(uncredit.succeeded());

                  AND_THEN("The payer for storage costs of the NFT do not change")
                  {
                     CHECK(uncredit.diskConsumed({{}}));
                  }
               }
               THEN("Alice may not credit the NFT to someone else")
               {
                  auto credit = a.credit(charlie, nft.id, "Memo");
                  CHECK(credit.failed(alreadyCredited));
               }
               AND_WHEN("Bob debits the NFT")
               {
                  auto debit = b.debit(nft.id);

                  THEN("Bob owns the NFT")
                  {
                     CHECK(bob.id == b.getNft(nft.id).returnVal()->owner);
                  }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(a.uncredit(nft.id).failed(uncreditRequiresCredit));
                     CHECK(a.debit(nft.id).failed(debitRequiresCredit));
                     CHECK(c.uncredit(nft.id).failed(uncreditRequiresCredit));
                     CHECK(c.debit(nft.id).failed(debitRequiresCredit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(b.debit(nft.id).failed(debitRequiresCredit));
                  }
               }
               AND_WHEN("Alice uncredits the NFT")
               {
                  a.uncredit(nft.id);

                  THEN("No one can debit or uncredit the NFT")
                  {
                     CHECK(a.uncredit(nft.id).failed(uncreditRequiresCredit));
                     CHECK(b.uncredit(nft.id).failed(uncreditRequiresCredit));
                     CHECK(c.uncredit(nft.id).failed(uncreditRequiresCredit));

                     CHECK(a.debit(nft.id).failed(debitRequiresCredit));
                     CHECK(b.debit(nft.id).failed(debitRequiresCredit));
                     CHECK(c.debit(nft.id).failed(debitRequiresCredit));
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
