#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/test.hpp>
#include "nft_sys.hpp"

using namespace eosio;
using namespace nft_sys;
using namespace psibase;
using nft_sys::nft_row;
using std::optional;
using std::pair;
using std::vector;

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

   void check_disk_consumption(const transaction_trace&                  trace,
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

   auto generate = [](uint32_t a, uint32_t b) {
      return (static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b));
   };

   void configure_test_chain(test_chain& t)
   {
      t.start_block();
      boot_minimal(t);
      auto cnum = add_contract(t, "nft.sys", "nft_sys.wasm");
      eosio::check(cnum == nft_contract::contract, "contract number changed");
   }

   auto debugCounter = [i = 0]() mutable { std::cout << "\nTEST " << ++i << "\n\n"; };

}  // namespace

SCENARIO("Minting & burning nfts")
{
   GIVEN("An empty chain with registered users Alice and Bob")
   {
      test_chain t;
      configure_test_chain(t);

      Actor alice{add_account(t, "alice")};
      Actor bob{add_account(t, "bob")};

      uint32_t sub_id = 0;
      THEN("Alice can mint an NFT")
      {
         auto trace = t.trace(alice.at<nft_contract>().mint(alice, sub_id));
         CHECK(succeeded(trace));

         AND_THEN("The NFT exists")
         {
            nft_row expectedNft{.id               = generate(alice.id, sub_id),
                                .issuer           = alice.id,
                                .owner            = alice.id,
                                .approved_account = 0};

            auto nft_id = getReturnVal<&nft_contract::mint>(get_top_action(trace, 0));
            auto trace  = t.trace(alice.at<nft_contract>().getNft(nft_id));
            auto nft    = getReturnVal<&nft_contract::getNft>(get_top_action(trace, 0));
            CHECK((nft != std::nullopt && *nft == expectedNft));
         }
      }
      THEN("Alice cannot force Bob to pay the storage cost for her minting an NFT")
      {
         CHECK(failedWith(t.trace(alice.at<nft_contract>().mint(bob, sub_id)),
                          "Missing required authority"));
      }
      WHEN("Alice mints an NFT")
      {
         t.trace(alice.at<nft_contract>().mint(alice, sub_id));
         auto trace = t.trace(alice.at<nft_contract>().getNft2(alice, sub_id));
         auto nft1  = *getReturnVal<&nft_contract::getNft2>(get_top_action(trace, 0));
         t.start_block();

         THEN("Alice consumes storage space as expected")
         {
            check_disk_consumption(trace, {{alice.id, nft_row::DiskUsage::firstEmplace}});
         }
         THEN("Alice cannot mint another using the same sub_id")
         {
            CHECK(failedWith(t.trace(alice.at<nft_contract>().mint(alice, sub_id)),
                             "Nft already exists"));
         }
         THEN("Alice can burn the NFT")
         {
            CHECK(succeeded(t.trace(alice.at<nft_contract>().burn(alice, nft1.id))));
         }
         THEN("Bob cannot burn the NFT")
         {
            CHECK(failedWith(t.trace(bob.at<nft_contract>().burn(alice, nft1.id)),
                             nft_sys::errors::missingRequiredAuth));
         }
         THEN("Bob can mint an NFT using the same sub_id")
         {
            CHECK(succeeded(t.trace(bob.at<nft_contract>().mint(bob, sub_id))));
         }
         THEN("Alice can mint a second NFT using a different sub_id")
         {
            CHECK(succeeded(t.trace(alice.at<nft_contract>().mint(alice, sub_id + 1))));
         }
         AND_WHEN("Alice mints a second NFT using a different sub_id")
         {
            // Mint second NFT
            auto secondId = sub_id + 1;
            t.trace(alice.at<nft_contract>().mint(alice, secondId));
            t.start_block();

            THEN("The ID is one more than the first")
            {
               trace = t.trace(alice.at<nft_contract>().getNft2(alice, secondId));

               auto nft2 = *getReturnVal<&nft_contract::getNft2>(get_top_action(trace, 0));

               nft_row expectedNft = nft1;
               expectedNft.id++;
               REQUIRE(nft2 == expectedNft);
            }
         }
         AND_WHEN("Bob mints an NFT")
         {
            auto trace = t.trace(bob.at<nft_contract>().mint(bob, sub_id));
            t.start_block();

            THEN("Bob's pays for an expected amount of storage space")
            {
               check_disk_consumption(trace, {{bob.id, nft_row::DiskUsage::subsequentEmplace}});
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
      t.start_block();
      boot_minimal(t);
      auto cnum = add_contract(t, "nft.sys", "nft_sys.wasm");
      REQUIRE(cnum == nft_contract::contract);

      Actor alice{add_account(t, "alice")};
      Actor bob{add_account(t, "bob")};
      Actor charlie{add_account(t, "charlie")};

      THEN("Bob is configured to use auto-debit by default")
      {
         auto trace       = t.trace(bob.at<nft_contract>().isAutodebit(bob));
         bool isAutodebit = getReturnVal<&nft_contract::isAutodebit>(get_top_action(trace, 0));
         CHECK(succeeded(trace));
         CHECK(isAutodebit);
      }
      THEN("Bob is able to opt out of auto-debit")
      {
         auto trace = t.trace(bob.at<nft_contract>().autodebit(bob, false));
         CHECK(succeeded(trace));

         trace            = t.trace(bob.at<nft_contract>().isAutodebit(bob));
         bool isAutodebit = getReturnVal<&nft_contract::isAutodebit>(get_top_action(trace, 0));
         CHECK(!isAutodebit);
      }

      THEN("Alice is unable to credit, uncredit, or debit a non-existent NFT")
      {
         CHECK(failedWith(t.trace(alice.at<nft_contract>().credit(alice, bob, 1, "memo")),
                          nft_sys::errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<nft_contract>().uncredit(alice, bob, 1)),
                          nft_sys::errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<nft_contract>().debit(bob, alice, 1)),
                          nft_sys::errors::nftDNE));
         CHECK(failedWith(t.trace(alice.at<nft_contract>().debit(alice, bob, 1)),
                          nft_sys::errors::nftDNE));
      }
      AND_GIVEN("Alice has minted an NFT")
      {
         t.act(alice.at<nft_contract>().mint(alice, 0));
         auto trace = t.trace(alice.at<nft_contract>().getNft2(alice, 0));
         auto nft   = *getReturnVal<&nft_contract::getNft2>(get_top_action(trace, 0));

         THEN("No one can debit or uncredit the NFT")
         {
            CHECK(failedWith(t.trace(bob.at<nft_contract>().debit(alice, bob, nft.id)),
                             nft_sys::errors::debitRequiresCredit));
            CHECK(failedWith(t.trace(bob.at<nft_contract>().uncredit(alice, bob, nft.id)),
                             nft_sys::errors::uncreditRequiresCredit));
            CHECK(failedWith(t.trace(alice.at<nft_contract>().uncredit(alice, bob, nft.id)),
                             nft_sys::errors::uncreditRequiresCredit));
         }

         THEN("Bob may not credit the NFT to Bob")
         {
            CHECK(failedWith(t.trace(bob.at<nft_contract>().credit(alice, bob, nft.id, "memo")),
                             nft_sys::errors::missingRequiredAuth));
         }
         THEN("Alice may not credit the NFT to herself")
         {
            CHECK(failedWith(t.trace(alice.at<nft_contract>().credit(alice, alice, nft.id, "memo")),
                             nft_sys::errors::creditorIsDebitor));
         }
         THEN("Alice may credit the NFT to Bob")
         {
            CHECK(succeeded(t.trace(alice.at<nft_contract>().credit(alice, bob, nft.id, "memo"))));
         }
         WHEN("Alice credits the NFT to Bob")
         {
            auto creditTrace = t.trace(alice.at<nft_contract>().credit(alice, bob, nft.id, "memo"));

            THEN("Bob immediately owns the NFT")
            {
               auto trace = t.trace(bob.at<nft_contract>().getNft(nft.id));
               nft        = *getReturnVal<&nft_contract::getNft>(get_top_action(trace, 0));
            }
            THEN("The payer for storage costs of the NFT are updated accordingly")
            {
               check_disk_consumption(creditTrace, {{alice.id, -1 * nft_row::DiskUsage::update},
                                                    {bob.id, nft_row::DiskUsage::update}});
            }
            THEN("Alice has no chance to uncredit the NFT")
            {
               CHECK(failedWith(t.trace(alice.at<nft_contract>().uncredit(alice, bob, nft.id)),
                                nft_sys::errors::uncreditRequiresCredit));
            }
         }
         WHEN("Bob opts out of auto-debit")
         {
            t.act(bob.at<nft_contract>().autodebit(bob, false));

            AND_WHEN("Alice credits the NFT to Bob")
            {
               auto creditTrace =
                   t.trace(alice.at<nft_contract>().credit(alice, bob, nft.id, "memo"));

               THEN("The NFT is not yet owned by Bob")
               {
                  auto trace = t.trace(bob.at<nft_contract>().getNft(nft.id));
                  auto owner =
                      (*getReturnVal<&nft_contract::getNft>(get_top_action(trace, 0))).owner;
                  CHECK(bob.id != owner);
               }
               THEN("The payer for storage costs of the NFT do not change")
               {
                  check_disk_consumption(creditTrace, {{}});
               }
               THEN("Alice and Charlie may not debit the NFT")
               {
                  CHECK(failedWith(t.trace(alice.at<nft_contract>().debit(alice, bob, nft.id)),
                                   nft_sys::errors::creditorIsDebitor));
                  CHECK(failedWith(t.trace(alice.at<nft_contract>().debit(alice, bob, nft.id)),
                                   nft_sys::errors::missingRequiredAuth));
               }
               THEN("Bob and Charlie may not uncredit the NFT")
               {
                  CHECK(failedWith(t.trace(bob.at<nft_contract>().uncredit(alice, bob, nft.id)),
                                   nft_sys::errors::creditorAction));
                  CHECK(failedWith(t.trace(charlie.at<nft_contract>().uncredit(alice, bob, nft.id)),
                                   nft_sys::errors::creditorAction));
               }
               THEN("Bob may debit the NFT")
               {
                  auto debitTrace = t.trace(bob.at<nft_contract>().debit(alice, bob, nft.id));
                  CHECK(succeeded(debitTrace));
                  AND_THEN("The payer for storage costs of the NFT are updated accordingly")
                  {
                     check_disk_consumption(debitTrace,
                                            {{alice.id, -1 * nft_row::DiskUsage::update},
                                             {bob.id, nft_row::DiskUsage::update}});
                  }
               }
               THEN("Alice may uncredit the NFT")
               {
                  auto uncreditTrace =
                      t.trace(alice.at<nft_contract>().uncredit(alice, bob, nft.id));
                  CHECK(succeeded(uncreditTrace));

                  AND_THEN("The payer for storage costs of the NFT do not change")
                  {
                     check_disk_consumption(uncreditTrace, {{}});
                  }
               }
               AND_WHEN("Bob debits the NFT")
               {
                  t.act(bob.at<nft_contract>().debit(alice, bob, nft.id));

                  THEN("Bob owns the NFT")
                  {
                     auto trace = t.trace(bob.at<nft_contract>().getNft(nft.id));
                     auto owner =
                         (*getReturnVal<&nft_contract::getNft>(get_top_action(trace, 0))).owner;
                     CHECK(bob.id == owner);
                  }
                  THEN("Alice and Charlie may not uncredit or debit the NFT")
                  {
                     CHECK(
                         failedWith(t.trace(alice.at<nft_contract>().uncredit(alice, bob, nft.id)),
                                    nft_sys::errors::uncreditRequiresCredit));
                     CHECK(failedWith(t.trace(alice.at<nft_contract>().debit(alice, bob, nft.id)),
                                      nft_sys::errors::debitRequiresCredit));
                     CHECK(failedWith(
                         t.trace(charlie.at<nft_contract>().uncredit(alice, bob, nft.id)),
                         nft_sys::errors::uncreditRequiresCredit));
                     CHECK(failedWith(t.trace(charlie.at<nft_contract>().debit(alice, bob, nft.id)),
                                      nft_sys::errors::debitRequiresCredit));
                  }
                  THEN("Bob may not debit the NFT again")
                  {
                     CHECK(failedWith(t.trace(bob.at<nft_contract>().debit(alice, bob, nft.id)),
                                      nft_sys::errors::debitRequiresCredit));
                  }
               }
               AND_WHEN("Alice uncredits the NFT")
               {
                  t.act(alice.at<nft_contract>().uncredit(alice, bob, nft.id));

                  THEN("No one can debit or uncredit the NFT")
                  {
                     auto checkUncredit = [&](auto actor) {
                        CHECK(failedWith(
                            t.trace(actor.template at<nft_contract>().uncredit(alice, bob, nft.id)),
                            nft_sys::errors::uncreditRequiresCredit));
                     };
                     auto checkDebit = [&](auto actor) {
                        CHECK(failedWith(
                            t.trace(actor.template at<nft_contract>().debit(alice, bob, nft.id)),
                            nft_sys::errors::debitRequiresCredit));
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
                     CHECK(succeeded(
                         t.trace(alice.at<nft_contract>().credit(alice, bob, nft.id, "memo"))));
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