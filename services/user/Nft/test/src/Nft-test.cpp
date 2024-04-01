#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <psio/fracpack.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/commonErrors.hpp>
#include <string>

#include "services/user/Nft.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace psibase;
using std::optional;
using std::pair;
using std::string;
using std::vector;
using UserService::NftRecord;

namespace
{
   constexpr auto manualDebit = "manualDebit"_m;
}  // namespace

SCENARIO("Minting & burning nfts")
{
   GIVEN("An empty chain with registered users Alice and Bob")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));

      auto a = alice.to<Nft>();
      auto b = bob.to<Nft>();

      THEN("Alice can mint an NFT")
      {
         auto mint = a.mint();
         CHECK(mint.succeeded());

         AND_THEN("The NFT exists")
         {
            NftRecord expected{
                .id     = 2,         // Second minted NFT (first is the system token)
                .issuer = alice.id,  //
                .owner  = alice.id   //
            };

            auto nft = a.getNft(mint.returnVal()).returnVal();

            // Todo - Use simple comparison if/when eventHead is removed from the record.
            //CHECK(nft == expected);

            CHECK(nft.id == expected.id);
            CHECK(nft.issuer == expected.issuer);
            CHECK(nft.owner == expected.owner);
         }
      }
      WHEN("Alice mints an NFT")
      {
         auto mint  = a.mint();
         auto mint2 = a.mint();
         auto nft1  = a.getNft(mint.returnVal()).returnVal();

         THEN("Alice can burn the NFT")
         {  //
            CHECK(a.burn(nft1.id).succeeded());

            AND_THEN("The NFT no longer exists")
            {  //
               CHECK(a.getNft(nft1.id).failed(nftBurned));
            }
         }
         THEN("Alice cannot burn a nonexistent NFT")
         {  //
            CHECK(a.burn(99).failed(nftDNE));
         }
         THEN("Bob cannot burn the NFT")
         {  //
            CHECK(b.burn(nft1.id).failed(missingRequiredAuth));
         }
         AND_WHEN("Alice mints a second NFT")
         {
            auto mint3 = a.mint();

            THEN("The NFT is identical in every way, except the ID is incremented")
            {
               auto      nft3     = a.getNft(mint3.returnVal()).returnVal();
               NftRecord expected = nft1;
               expected.id += 2;
               CHECK(nft3.id == expected.id);
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
      DefaultTestChain t;

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"));
      auto charlie = t.from(t.addAccount("charlie"));

      auto a = alice.to<Nft>();
      auto b = bob.to<Nft>();
      auto c = charlie.to<Nft>();

      THEN("Bob is configured to use auto-debit by default")
      {
         CHECK(b.getUserConf(bob, manualDebit).returnVal() == false);
      }
      THEN("Bob is able to opt in to manual-debit")
      {
         CHECK(b.setUserConf(manualDebit, true).succeeded());
         CHECK(true == b.getUserConf(bob, manualDebit).returnVal());
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         NID invalidId = 99;
         CHECK(a.credit(invalidId, bob, "memo").failed(nftDNE));
         CHECK(a.uncredit(invalidId, "memo").failed(nftDNE));
         CHECK(a.debit(invalidId, "memo").failed(nftDNE));
         CHECK(a.debit(invalidId, "memo").failed(nftDNE));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         auto mint = a.mint();
         auto nft  = a.getNft(mint.returnVal()).returnVal();

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(b.debit(nft.id, "memo").failed(debitRequiresCredit));
            CHECK(b.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
            CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
         }

         THEN("Bob may not credit the NFT to Bob")
         {
            CHECK(b.credit(nft.id, alice, "memo").failed(missingRequiredAuth));
         }
         THEN("Alice may not credit the NFT to herself")
         {
            CHECK(a.credit(nft.id, alice, "memo").failed(creditorIsDebitor));
         }
         THEN("Alice may credit the NFT to Bob")
         {
            CHECK(a.credit(nft.id, bob, "memo").succeeded());
         }
         WHEN("Alice credits the NFT to Bob")
         {
            auto credit = a.credit(nft.id, bob, "memo");

            THEN("Bob immediately owns the NFT")
            {
               auto newNft = b.getNft(nft.id).returnVal();
               CHECK(newNft.owner == bob.id);
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
            }
         }
         WHEN("Bob opts in to manual-debit")
         {
            b.setUserConf(manualDebit, true);

            AND_WHEN("Alice credits the NFT to Bob")
            {
               auto credit = a.credit(nft.id, bob, "memo");

               THEN("The NFT is not yet owned by Bob")
               {
                  CHECK(bob.id != b.getNft(nft.id).returnVal().owner);
               }
               THEN("Alice and Charlie may not debit the NFT")
               {
                  CHECK(a.debit(nft.id, "memo").failed(missingRequiredAuth));
                  CHECK(c.debit(nft.id, "memo").failed(missingRequiredAuth));
               }
               THEN("Bob and Charlie may not uncredit the NFT")
               {
                  CHECK(b.uncredit(nft.id, "memo").failed(creditorAction));
                  CHECK(c.uncredit(nft.id, "memo").failed(creditorAction));
               }
               THEN("Bob may debit the NFT")
               {
                  auto debit = b.debit(nft.id, "memo");
                  CHECK(debit.succeeded());
               }
               THEN("Alice may uncredit the NFT")
               {
                  auto uncredit = a.uncredit(nft.id, "memo");
                  CHECK(uncredit.succeeded());
               }
               THEN("Alice may not credit the NFT to someone else")
               {
                  auto credit = a.credit(nft.id, charlie, "Memo");
                  CHECK(credit.failed(alreadyCredited));
               }
               AND_WHEN("Bob debits the NFT")
               {
                  auto debit = b.debit(nft.id, "memo");

                  THEN("Bob owns the NFT")
                  {
                     CHECK(bob.id == b.getNft(nft.id).returnVal().owner);
                  }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(a.debit(nft.id, "memo").failed(debitRequiresCredit));
                     CHECK(c.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(c.debit(nft.id, "memo").failed(debitRequiresCredit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(b.debit(nft.id, "memo").failed(debitRequiresCredit));
                  }
               }
               AND_WHEN("Alice uncredits the NFT")
               {
                  a.uncredit(nft.id, "memo");

                  THEN("No one can debit or uncredit the NFT")
                  {
                     CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(b.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(c.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));

                     CHECK(a.debit(nft.id, "memo").failed(debitRequiresCredit));
                     CHECK(b.debit(nft.id, "memo").failed(debitRequiresCredit));
                     CHECK(c.debit(nft.id, "memo").failed(debitRequiresCredit));
                  }
                  THEN("Alice may credit the NFT again")
                  {
                     CHECK(a.credit(nft.id, bob, "memo").succeeded());
                  }
               }
            }
         }
      }
   }
}
