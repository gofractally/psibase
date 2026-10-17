#include <catch2/catch_all.hpp>
#include <cstdint>
#include <format>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/checkSchema.hpp>
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

namespace
{
   constexpr auto autoDebit = Nft::autoDebit;

   struct FirstIdData
   {
      NID firstAvailableId;
   };
   PSIO_REFLECT(FirstIdData, firstAvailableId);

   struct FirstIdRoot
   {
      FirstIdData data;
   };
   PSIO_REFLECT(FirstIdRoot, data);

   struct StatusNft
   {
      NID id;
   };
   PSIO_REFLECT(StatusNft, id);

   struct StatusData
   {
      string                state;
      optional<StatusNft>   nftDetail;
   };
   PSIO_REFLECT(StatusData, state, nftDetail);

   struct StatusNode
   {
      StatusData nftStatus;
   };
   PSIO_REFLECT(StatusNode, nftStatus);

   struct StatusRoot
   {
      StatusNode data;
   };
   PSIO_REFLECT(StatusRoot, data);

   NID firstAvailable(DefaultTestChain& t, NID begin)
   {
      auto query = std::format("query {{ firstAvailableId(begin: {}) }}", begin);
      auto res   = t.post(Nft::service, "/graphql", GraphQLBody{query});
      auto body  = std::string(res.body.begin(), res.body.end());
      UNSCOPED_INFO(body);
      return psio::convert_from_json<FirstIdRoot>(body).data.firstAvailableId;
   }

   StatusData nftStatus(DefaultTestChain& t, NID id)
   {
      auto query = std::format("query {{ nftStatus(nftId: {}) {{ state nftDetail {{ id }} }} }}", id);
      auto res   = t.post(Nft::service, "/graphql", GraphQLBody{query});
      auto body  = std::string(res.body.begin(), res.body.end());
      UNSCOPED_INFO(body);
      return psio::convert_from_json<StatusRoot>(body).data.nftStatus;
   }
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
            // ID may not match if the boot packages mint NFTs during initialization
            NftRecord expected{.id = 1, .issuer = alice.id, .owner = alice.id};

            auto nft = a.getNft(mint.returnVal()).returnVal().value();

            // Todo - Use simple comparison if/when eventHead is removed from the record.
            //CHECK(nft == expected);

            CHECK(nft.issuer == expected.issuer);
            CHECK(nft.owner == expected.owner);
         }
      }
      WHEN("Alice mints an NFT")
      {
         auto mint  = a.mint();
         auto mint2 = a.mint();
         auto nft1  = a.getNft(mint.returnVal()).returnVal().value();

         THEN("Alice can burn the NFT")
         {  //
            CHECK(a.burn(nft1.id).succeeded());

            AND_THEN("The NFT no longer exists")
            {  //
               CHECK(!a.getNft(nft1.id).returnVal().has_value());
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
               auto      nft3     = a.getNft(mint3.returnVal()).returnVal().value();
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

      THEN("Bob has auto-debit disabled by default")
      {
         CHECK(b.getUserConf(bob, autoDebit).returnVal() == false);
      }
      THEN("Bob is able to opt in to auto-debit")
      {
         CHECK(b.setUserConf(autoDebit, true).succeeded());
         CHECK(true == b.getUserConf(bob, autoDebit).returnVal());
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         NID invalidId = 99;
         CHECK(a.credit(invalidId, bob, "memo").failed(nftDNE));
         CHECK(a.uncredit(invalidId, "memo").failed(uncreditRequiresCredit));
         CHECK(a.debit(invalidId, "memo").failed(nothingToDebit));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         auto mint = a.mint();
         auto nft  = a.getNft(mint.returnVal()).returnVal().value();

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(b.debit(nft.id, "memo").failed(nothingToDebit));
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
            bob.to<Nft>().setUserConf(autoDebit, true);
            CHECK(a.credit(nft.id, bob, "memo").succeeded());

            THEN("Bob immediately owns the NFT")
            {
               auto newNft = b.getNft(nft.id).returnVal().value();
               CHECK(newNft.owner == bob.id);
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
            }
         }
         WHEN("Bob opts out of auto-debit")
         {
            b.setUserConf(autoDebit, false);

            AND_WHEN("Alice credits the NFT to Bob")
            {
               auto credit = a.credit(nft.id, bob, "memo");

               THEN("The NFT is not yet owned by Bob")
               {
                  CHECK(bob.id != b.getNft(nft.id).returnVal().value().owner);
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
                     CHECK(bob.id == b.getNft(nft.id).returnVal().value().owner);
                  }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(a.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(a.debit(nft.id, "memo").failed(nothingToDebit));
                     CHECK(c.uncredit(nft.id, "memo").failed(uncreditRequiresCredit));
                     CHECK(c.debit(nft.id, "memo").failed(nothingToDebit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(b.debit(nft.id, "memo").failed(nothingToDebit));
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

                     CHECK(a.debit(nft.id, "memo").failed(nothingToDebit));
                     CHECK(b.debit(nft.id, "memo").failed(nothingToDebit));
                     CHECK(c.debit(nft.id, "memo").failed(nothingToDebit));
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

SCENARIO("mint with an explicit id")
{
   GIVEN("A chain with Alice")
   {
      DefaultTestChain t;
      auto             alice = t.from(t.addAccount("alice"_a));
      auto             a     = alice.to<Nft>();

      auto first = a.mint();
      REQUIRE(first.succeeded());
      NID sequential = first.returnVal();
      NID next       = sequential + 1;

      THEN("A free id above the counter can be chosen")
      {
         NID chosen = next + 10;
         CHECK(firstAvailable(t, chosen) == chosen);
         CHECK(firstAvailable(t, 0) == next);

         auto minted = a.mint(chosen);
         REQUIRE(minted.succeeded());
         CHECK(minted.returnVal() == chosen);

         auto nft = a.getNft(chosen).returnVal().value();
         CHECK(nft.owner == alice.id);
         CHECK(nft.issuer == alice.id);

         auto active = nftStatus(t, chosen);
         CHECK(active.state == "active");
         REQUIRE(active.nftDetail.has_value());
         CHECK(active.nftDetail->id == chosen);
         CHECK(firstAvailable(t, chosen) == chosen + 1);
         CHECK(firstAvailable(t, 0) == next);

         AND_THEN("That id cannot be minted again")
         {
            CHECK(a.mint(chosen).failed(nftIdTaken));
         }
         AND_THEN("The counter skips the chosen id")
         {
            NID id = next - 1;
            while (id < chosen)
            {
               auto mint = a.mint();
               REQUIRE(mint.succeeded());
               id = mint.returnVal();
               CHECK(id != chosen);
            }
            CHECK(id == chosen + 1);
         }
      }
      THEN("Id 0 is rejected")
      {
         CHECK(a.mint(NID{0}).failed(invalidNftId));
      }
      THEN("A burned sequential id cannot be reused")
      {
         REQUIRE(a.burn(sequential).succeeded());
         CHECK(!a.getNft(sequential).returnVal().has_value());
         CHECK(a.exists(sequential).returnVal() == false);
         CHECK(a.mint(sequential).failed(nftIdTaken));
         CHECK(firstAvailable(t, sequential) == next);
         auto burned = nftStatus(t, sequential);
         CHECK(burned.state == "burned");
         CHECK_FALSE(burned.nftDetail.has_value());
         auto missing = nftStatus(t, next + 50);
         CHECK(missing.state == "available");
         CHECK_FALSE(missing.nftDetail.has_value());
      }
      THEN("A burned explicit id cannot be reused")
      {
         NID chosen = next + 10;
         REQUIRE(a.mint(chosen).succeeded());
         REQUIRE(a.burn(chosen).succeeded());
         CHECK(!a.getNft(chosen).returnVal().has_value());
         CHECK(a.exists(chosen).returnVal() == false);
         CHECK(a.mint(chosen).failed(nftIdTaken));
         CHECK(firstAvailable(t, chosen) == chosen + 1);
         CHECK(firstAvailable(t, 0) == next);
      }
      THEN("Search wraps past the last id and skips 0")
      {
         constexpr NID last = 0xffffffffu;
         CHECK(firstAvailable(t, last) == last);
         REQUIRE(a.mint(last).succeeded());
         CHECK(firstAvailable(t, last) == firstAvailable(t, 0));
         CHECK(firstAvailable(t, 0) != 0);
         CHECK(firstAvailable(t, last) != last);
      }
   }
}

TEST_CASE("nft schema")
{
   CHECK_SCHEMA(Nft);
}
