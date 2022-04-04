#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

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
using UserContract::NftRow;

namespace
{
   bool succeeded(const transaction_trace& t)
   {
      bool ret = (show(false, t) == "");
      if (!ret && t.error != std::nullopt)
      {
         UNSCOPED_INFO("transaction has exception: " << *t.error << "\n");
      }
      else if (!ret)
      {
         UNSCOPED_INFO("transaction failed, but was expected to succeed");
      }
      return ret;
   };
   bool failedWith(const transaction_trace& t, std::string_view err)
   {
      bool hasError = t.error != std::nullopt;
      bool ret      = (hasError && t.error->find(err.data()) != string::npos);
      if (hasError && !ret)
      {
         UNSCOPED_INFO("transaction has exception: " << *t.error << "\n");
      }
      else if (!hasError)
      {
         UNSCOPED_INFO("transaction succeeded, but was expected to fail");
      }
      return ret;
   }

   void checkDiskConsumption(const transaction_trace&                  trace,
                             const vector<pair<account_num, int64_t>>& consumption)
   {
      const vector<action_trace>& actions = trace.action_traces;
      INFO("This check expects only single action traces");
      CHECK(actions.size() == 2);
      //const auto& ram_deltas = actions.at(0).account_ram_deltas;

      {
         INFO("Check for equality in the total number of RAM changes");
         //CHECK(ram_deltas.size() == consumption.size());
      }

      {
         INFO("Check that each actual RAM delta was in the set of expected deltas");
         // for (const auto& delta : ram_deltas)
         // {
         //    bool foundMatch =
         //        std::any_of(consumption.begin(), consumption.end(), [&](const auto& cPair) {
         //           return cPair.first == delta.account && cPair.second == delta.delta;
         //        });
         //    if (!foundMatch)
         //    {
         //       INFO("Real RAM Delta: [" << delta.account.to_string() << "]["
         //                                << std::to_string(delta.delta) << "]");
         //       CHECK(false);
         //    }
         // }
      }
   }

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

      Actor alice{add_account(t, "alice")};
      Actor bob{add_account(t, "bob")};

      THEN("Alice can mint an NFT")
      {
         auto trace = t.trace(alice.at<NftSys>().mint(alice));
         CHECK(succeeded(trace));

         AND_THEN("The NFT exists")
         {
            NftRow expectedNft{
                .id              = 1,         // First minted NFT (skipping 0)
                .issuer          = alice.id,  //
                .owner           = alice.id,  //
                .approvedAccount = system_contract::account_sys::null_account  //
            };

            auto nftId = getReturnVal<&NftSys::mint>(get_top_action(trace, 0));
            auto trace = t.trace(alice.at<NftSys>().getNft(nftId));
            auto nft   = getReturnVal<&NftSys::getNft>(get_top_action(trace, 0));
            CHECK((nft != std::nullopt && *nft == expectedNft));
         }
      }
      THEN("Alice cannot force Bob to pay the storage cost for her minting an NFT")
      {
         CHECK(failedWith(t.trace(alice.at<NftSys>().mint(bob)), "Missing required authority"));
      }
      WHEN("Alice mints an NFT")
      {
         auto trace = t.trace(alice.at<NftSys>().mint(alice));
         auto nftId = getReturnVal<&NftSys::mint>(get_top_action(trace, 0));
         trace      = t.trace(alice.at<NftSys>().getNft(nftId));
         auto nft1  = *getReturnVal<&NftSys::getNft>(get_top_action(trace, 0));
         t.start_block();

         THEN("Alice consumes storage space as expected")
         {
            checkDiskConsumption(trace, {{alice.id, NftRow::DiskUsage::firstEmplace}});
         }
         THEN("Alice can burn the NFT")
         {
            CHECK(succeeded(t.trace(alice.at<NftSys>().burn(alice, nft1.id))));
         }
         THEN("Bob cannot burn the NFT")
         {
            CHECK(failedWith(t.trace(bob.at<NftSys>().burn(alice, nft1.id)),
                             UserContract::Errors::missingRequiredAuth));
         }
         AND_WHEN("Alice mints a second NFT")
         {
            // Mint second NFT
            trace = t.trace(alice.at<NftSys>().mint(alice));
            t.start_block();

            THEN("The ID is one more than the first")
            {
               auto nftId2 = getReturnVal<&NftSys::mint>(get_top_action(trace, 0));
               trace       = t.trace(alice.at<NftSys>().getNft(nftId2));
               auto nft2   = *getReturnVal<&NftSys::getNft>(get_top_action(trace, 0));

               NftRow expectedNft = nft1;
               expectedNft.id++;
               REQUIRE(nft2 == expectedNft);
            }
         }
         AND_WHEN("Bob mints an NFT")
         {
            auto trace = t.trace(bob.at<NftSys>().mint(bob));
            t.start_block();

            THEN("Bob's pays for an expected amount of storage space")
            {
               checkDiskConsumption(trace, {{bob.id, NftRow::DiskUsage::subsequentEmplace}});
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

      Actor alice{add_account(t, "alice")};
      Actor bob{add_account(t, "bob")};
      Actor charlie{add_account(t, "charlie")};

      THEN("Bob is configured to use auto-debit by default")
      {
         auto trace       = t.trace(bob.at<NftSys>().isAutodebit(bob));
         bool isAutodebit = getReturnVal<&NftSys::isAutodebit>(get_top_action(trace, 0));
         CHECK(succeeded(trace));
         CHECK(isAutodebit);
      }
      THEN("Bob is able to opt out of auto-debit")
      {
         auto trace = t.trace(bob.at<NftSys>().autodebit(bob, false));
         CHECK(succeeded(trace));

         trace            = t.trace(bob.at<NftSys>().isAutodebit(bob));
         bool isAutodebit = getReturnVal<&NftSys::isAutodebit>(get_top_action(trace, 0));
         CHECK(!isAutodebit);
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         CHECK(failedWith(t.trace(alice.at<NftSys>().credit(alice, bob, 1, "memo")),
                          UserContract::Errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<NftSys>().uncredit(alice, bob, 1)),
                          UserContract::Errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<NftSys>().debit(bob, alice, 1)),
                          UserContract::Errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<NftSys>().debit(alice, bob, 1)),
                          UserContract::Errors::nftDNE));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         auto trace = t.trace(alice.at<NftSys>().mint(alice));

         auto nftId = getReturnVal<&NftSys::mint>(get_top_action(trace, 0));

         trace    = t.trace(alice.at<NftSys>().getNft(nftId));
         auto nft = *getReturnVal<&NftSys::getNft>(get_top_action(trace, 0));

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(failedWith(t.trace(bob.at<NftSys>().debit(alice, bob, nft.id)),
                             UserContract::Errors::debitRequiresCredit));
            CHECK(failedWith(t.trace(bob.at<NftSys>().uncredit(alice, bob, nft.id)),
                             UserContract::Errors::uncreditRequiresCredit));
            CHECK(failedWith(t.trace(alice.at<NftSys>().uncredit(alice, bob, nft.id)),
                             UserContract::Errors::uncreditRequiresCredit));
         }

         THEN("Bob may not credit the NFT to Bob")
         {
            CHECK(failedWith(t.trace(bob.at<NftSys>().credit(alice, bob, nft.id, "memo")),
                             UserContract::Errors::missingRequiredAuth));
         }
         THEN("Alice may not credit the NFT to herself")
         {
            CHECK(failedWith(t.trace(alice.at<NftSys>().credit(alice, alice, nft.id, "memo")),
                             UserContract::Errors::creditorIsDebitor));
         }
         THEN("Alice may credit the NFT to Bob")
         {
            CHECK(succeeded(t.trace(alice.at<NftSys>().credit(alice, bob, nft.id, "memo"))));
         }
         WHEN("Alice credits the NFT to Bob")
         {
            auto creditTrace = t.trace(alice.at<NftSys>().credit(alice, bob, nft.id, "memo"));

            THEN("Bob immediately owns the NFT")
            {
               auto trace = t.trace(bob.at<NftSys>().getNft(nft.id));
               nft        = *getReturnVal<&NftSys::getNft>(get_top_action(trace, 0));
            }
            THEN("The payer for storage costs of the NFT are updated accordingly")
            {
               checkDiskConsumption(creditTrace, {{alice.id, -1 * NftRow::DiskUsage::update},
                                                  {bob.id, NftRow::DiskUsage::update}});
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(failedWith(t.trace(alice.at<NftSys>().uncredit(alice, bob, nft.id)),
                                UserContract::Errors::uncreditRequiresCredit));
            }
         }
         WHEN("Bob opts out of auto-debit")
         {
            t.act(bob.at<NftSys>().autodebit(bob, false));

            AND_WHEN("Alice credits the NFT to Bob")
            {
               auto creditTrace = t.trace(alice.at<NftSys>().credit(alice, bob, nft.id, "memo"));

               THEN("The NFT is not yet owned by Bob")
               {
                  auto trace = t.trace(bob.at<NftSys>().getNft(nft.id));
                  auto owner = (*getReturnVal<&NftSys::getNft>(get_top_action(trace, 0))).owner;
                  CHECK(bob.id != owner);
               }
               THEN("The payer for storage costs of the NFT do not change")
               {
                  checkDiskConsumption(creditTrace, {{}});
               }
               THEN("Alice and Charlie may not debit the NFT")
               {
                  CHECK(failedWith(t.trace(alice.at<NftSys>().debit(alice, bob, nft.id)),
                                   UserContract::Errors::creditorIsDebitor));
                  CHECK(failedWith(t.trace(alice.at<NftSys>().debit(alice, bob, nft.id)),
                                   UserContract::Errors::missingRequiredAuth));
               }
               THEN("Bob and Charlie may not uncredit the NFT")
               {
                  CHECK(failedWith(t.trace(bob.at<NftSys>().uncredit(alice, bob, nft.id)),
                                   UserContract::Errors::creditorAction));
                  CHECK(failedWith(t.trace(charlie.at<NftSys>().uncredit(alice, bob, nft.id)),
                                   UserContract::Errors::creditorAction));
               }
               THEN("Bob may debit the NFT")
               {
                  auto debitTrace = t.trace(bob.at<NftSys>().debit(alice, bob, nft.id));
                  CHECK(succeeded(debitTrace));
                  AND_THEN("The payer for storage costs of the NFT are updated accordingly")
                  {
                     checkDiskConsumption(debitTrace, {{alice.id, -1 * NftRow::DiskUsage::update},
                                                       {bob.id, NftRow::DiskUsage::update}});
                  }
               }
               THEN("Alice may uncredit the NFT")
               {
                  auto uncreditTrace = t.trace(alice.at<NftSys>().uncredit(alice, bob, nft.id));
                  CHECK(succeeded(uncreditTrace));

                  AND_THEN("The payer for storage costs of the NFT do not change")
                  {
                     checkDiskConsumption(uncreditTrace, {{}});
                  }
               }
               AND_WHEN("Bob debits the NFT")
               {
                  t.act(bob.at<NftSys>().debit(alice, bob, nft.id));

                  THEN("Bob owns the NFT")
                  {
                     auto trace = t.trace(bob.at<NftSys>().getNft(nft.id));
                     auto owner = (*getReturnVal<&NftSys::getNft>(get_top_action(trace, 0))).owner;
                     CHECK(bob.id == owner);
                  }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(failedWith(t.trace(alice.at<NftSys>().uncredit(alice, bob, nft.id)),
                                      UserContract::Errors::uncreditRequiresCredit));
                     CHECK(failedWith(t.trace(alice.at<NftSys>().debit(alice, bob, nft.id)),
                                      UserContract::Errors::debitRequiresCredit));
                     CHECK(failedWith(t.trace(charlie.at<NftSys>().uncredit(alice, bob, nft.id)),
                                      UserContract::Errors::uncreditRequiresCredit));
                     CHECK(failedWith(t.trace(charlie.at<NftSys>().debit(alice, bob, nft.id)),
                                      UserContract::Errors::debitRequiresCredit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(failedWith(t.trace(bob.at<NftSys>().debit(alice, bob, nft.id)),
                                      UserContract::Errors::debitRequiresCredit));
                  }
               }
               AND_WHEN("Alice uncredits the NFT")
               {
                  t.act(alice.at<NftSys>().uncredit(alice, bob, nft.id));

                  THEN("No one can debit or uncredit the NFT")
                  {
                     auto checkUncredit = [&](auto actor) {
                        CHECK(failedWith(
                            t.trace(actor.template at<NftSys>().uncredit(alice, bob, nft.id)),
                            UserContract::Errors::uncreditRequiresCredit));
                     };
                     auto checkDebit = [&](auto actor) {
                        CHECK(failedWith(
                            t.trace(actor.template at<NftSys>().debit(alice, bob, nft.id)),
                            UserContract::Errors::debitRequiresCredit));
                     };

                     checkUncredit(alice);
                     checkUncredit(bob);
                     checkUncredit(charlie);

                     checkDebit(alice);
                     checkDebit(bob);
                     checkDebit(charlie);
                  }
                  THEN("Alice may credit the NFT again")
                  {
                     CHECK(
                         succeeded(t.trace(alice.at<NftSys>().credit(alice, bob, nft.id, "memo"))));
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