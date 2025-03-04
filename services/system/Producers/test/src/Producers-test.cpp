#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/Producers.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/VerifySig.hpp>
#include <services/user/Nft.hpp>

using namespace SystemService;
using namespace UserService;
using namespace psibase;

namespace
{
   auto pubFromPem = [](std::string param) {  //
      return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)};
   };

   auto privFromPem = [](std::string param) {  //
      return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)};
   };

   auto dana_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
                          "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
                           "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
                           "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
                           "-----END PRIVATE KEY-----\n")};

   auto elena_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
                          "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEbcmTuUFGjyAn0zd\n"
                           "7VKhIDZpswsI3m/5bMV+XoBQNTGhRANCAAQzeyU+Sa3KSwreirHYVfyB0jNMaNWt\n"
                           "GjyjVxTbjHHHyq96f3lqGlbApIe9u1CUDng/qlj0jGbuz5sOeeIY/DWJ\n"
                           "-----END PRIVATE KEY-----\n")};

   auto frank_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----"
                          "\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBIYTdIExsSGzMU+mShjxDeF7vpvj"
                          "\nsXBpMtw4lcaB5DxXxqPNWZCAwZNzTjEhYsOYWYrHKsLWOOuExQSnXPHr6g=="
                          "\n-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgbiTVSRup/IaLXIvH\n"
                           "qgsA/4UaAk39mbIe9/5Cx3m+A4ihRANCAAQEhhN0gTGxIbMxT6ZKGPEN4Xu+m+Ox\n"
                           "cGky3DiVxoHkPFfGo81ZkIDBk3NOMSFiw5hZiscqwtY464TFBKdc8evq\n"
                           "-----END PRIVATE KEY-----\n")};

   auto gary_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----"
                          "\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEb/vyUN9kprmmbKW7PQBsvzhKU5/o"
                          "\n8KAzO0SdPjGJ9o+NpCPgqgARIGBciczQjA2rIglzNA4RmHmukKl7L8yXlA=="
                          "\n-----END PUBLIC KEY-----\n"),

               privFromPem("-----BEGIN PRIVATE KEY-----"
                           "\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgtOdty5dQ9bOx9DSP"
                           "\nHJFR1vOkzfz35Js+RqIsL/aUKcGhRANCAARv+/JQ32SmuaZspbs9AGy/OEpTn+jw"
                           "\noDM7RJ0+MYn2j42kI+CqABEgYFyJzNCMDasiCXM0DhGYea6QqXsvzJeU"
                           "\n-----END PRIVATE KEY-----\n")};

   Producer createProducer(AccountNumber name)
   {
      return Producer{.name = name, .auth = Claim{}};
   }

   struct Node
   {
      uint32_t      id;
      AccountNumber issuer;
      AccountNumber owner;
   };
   PSIO_REFLECT(Node, id, issuer, owner);

   struct Edge
   {
      Node node;
   };
   PSIO_REFLECT(Edge, node);

   struct UserNfts
   {
      std::vector<Edge> edges;
   };
   PSIO_REFLECT(UserNfts, edges);

   struct Data
   {
      UserNfts userNfts;
   };
   PSIO_REFLECT(Data, userNfts);

   struct QueryRoot
   {
      Data data;
   };
   PSIO_REFLECT(QueryRoot, data);

}  // namespace

// Tx can be staged on behalf of prods-strong and prods-weak
// Set the producers, verify they can be retrieved
// Tx is executed/rejected only once the threshold is reached in both CFT and BFT
SCENARIO("Producers")
{
   GIVEN("Regular chain")
   {
      DefaultTestChain t;

      // User accounts
      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto charlie = t.from(t.addAccount("charlie"_a));

      // Producer accounts
      auto dana       = t.from(t.addAccount("dana"_a));
      auto prod_dana  = createProducer(dana.id);
      auto elena      = t.from(t.addAccount("elena"_a));
      auto prod_elena = createProducer(elena.id);
      auto frank      = t.from(t.addAccount("frank"_a));
      auto prod_frank = createProducer(frank.id);
      auto gary       = t.from(t.addAccount("gary"_a));
      auto prod_gary  = createProducer(gary.id);

      // Other accounts
      auto producers = t.from("producers"_a);
      auto weak      = "prods-weak"_a;
      auto strong    = "prods-strong"_a;
      auto rando     = t.from(t.addAccount("rando"_a));

      // Alice requires prods-strong
      REQUIRE(alice.to<AuthDelegate>().setOwner(strong).succeeded());
      REQUIRE(alice.to<Accounts>().setAuthServ(AuthDelegate::service).succeeded());

      // Bob requires prods-weak
      REQUIRE(bob.to<AuthDelegate>().setOwner(weak).succeeded());
      REQUIRE(bob.to<Accounts>().setAuthServ(AuthDelegate::service).succeeded());

      // Producer accounts use keys
      t.setAuth<AuthSig::AuthSig>(dana.id, dana_keys.first);
      t.setAuth<AuthSig::AuthSig>(elena.id, elena_keys.first);
      t.setAuth<AuthSig::AuthSig>(frank.id, frank_keys.first);
      t.setAuth<AuthSig::AuthSig>(gary.id, gary_keys.first);

      auto mintAction = [](AccountNumber acc)
      {
         return Action{.sender  = acc,
                       .service = Nft::service,
                       .method  = "mint"_m,
                       .rawData = psio::to_frac(std::tuple())

         };
      };
      auto proposed = [&](AccountNumber acc) { return std::vector<Action>{mintAction(acc)}; };

      auto getNfts = [](DefaultTestChain& t, AccountNumber acc)
      {
         std::string query_str = "query UserNfts { userNfts( user: \"" + acc.str() +
                                 "\" ) { edges { node { id issuer owner } } } "
                                 "}";
         std::string_view query_sv = query_str;

         auto query = GraphQLBody{query_sv};

         //psibase::writeConsole("Querying: " + std::string(query_sv) + "\n");
         auto res = t.post(Nft::service, "/graphql", query);

         auto body = std::string(res.body.begin(), res.body.end());
         //psibase::writeConsole(body + "\n");
         auto response_root = psio::convert_from_json<QueryRoot>(body);

         return response_root.data.userNfts.edges.size();
      };

      t.startBlock();
      t.startBlock();

      THEN("Producers can be retrieved")
      {
         auto prods = alice.to<Producers>().getProducers().returnVal();
         REQUIRE(prods == std::vector<AccountNumber>{"firstproducer"_a});
      }

      THEN("CFT Producer set can be changed")
      {
         auto newProds = std::vector<Producer>{prod_dana, prod_elena, prod_frank};
         REQUIRE(producers.to<Producers>().setProducers(newProds).succeeded());
         REQUIRE(alice.to<Producers>().getThreshold(weak).returnVal() == 1);
         REQUIRE(alice.to<Producers>().getThreshold(strong).returnVal() == 2);
      }

      WHEN("CFT Producer set changed")
      {
         auto newProds = std::vector<Producer>{prod_dana, prod_elena, prod_frank};
         producers.to<Producers>().setProducers(newProds);
         t.startBlock();
         t.startBlock();
         t.startBlock();

         THEN("Alice/bob has not minted any NFTs")
         {
            CHECK(getNfts(t, alice.id) == 0);
            CHECK(getNfts(t, bob.id) == 0);
         }

         THEN("Anyone can stage a tx for alice/bob")
         {
            auto proposeBob = rando.to<StagedTxService>().propose(proposed(bob.id), true);
            REQUIRE(proposeBob.succeeded());
            REQUIRE(getNfts(t, bob.id) == 0);
            auto proposeBobId = proposeBob.returnVal();

            auto proposeAlice = rando.to<StagedTxService>().propose(proposed(alice.id), true);
            REQUIRE(proposeAlice.succeeded());
            REQUIRE(getNfts(t, alice.id) == 0);
            auto proposeAliceId = proposeAlice.returnVal();

            AND_WHEN("One producer accepts bob's transaction")
            {
               auto txid = rando.to<StagedTxService>().get_staged_tx(proposeBobId).returnVal().txid;
               auto accept =
                   dana.with({dana_keys}).to<StagedTxService>().accept(proposeBobId, txid);
               REQUIRE(accept.succeeded());

               THEN("Bob (dependent on prods-weak) threshold was reached, so has minted an NFT")
               {
                  CHECK(getNfts(t, bob.id) == 1);
                  REQUIRE(rando.to<StagedTxService>()
                              .get_staged_tx(proposeBobId)
                              .failed("Unknown staged tx"));
               }
            }

            AND_WHEN("One producer accepts alice's transaction")
            {
               auto txid =
                   rando.to<StagedTxService>().get_staged_tx(proposeAliceId).returnVal().txid;
               auto accept =
                   dana.with({dana_keys}).to<StagedTxService>().accept(proposeAliceId, txid);
               REQUIRE(accept.succeeded());

               THEN(
                   "Alice (dependent on prods-strong) threshold was not reached, so has not minted "
                   "an NFT")
               {
                  REQUIRE(getNfts(t, alice.id) == 0);
               }

               AND_THEN("A second producer accepts alice's transaction")
               {
                  auto accept2 =
                      elena.with({elena_keys}).to<StagedTxService>().accept(proposeAliceId, txid);
                  REQUIRE(accept2.succeeded());
                  REQUIRE(getNfts(t, alice.id) == 1);

                  REQUIRE(rando.to<StagedTxService>()
                              .get_staged_tx(proposeAliceId)
                              .failed("Unknown staged tx"));
               }
            }
         }
      }

      WHEN("BFT is used instead of CFT")
      {
         auto setConsensus = producers.to<Producers>().setConsensus(ConsensusData{
             BftConsensus{.producers = {prod_dana, prod_elena, prod_frank, prod_gary}}});
         REQUIRE(setConsensus.succeeded());

         t.startBlock();
         t.startBlock();
         t.startBlock();

         REQUIRE(rando.to<Producers>().getThreshold(weak).returnVal() == 2);
         REQUIRE(rando.to<Producers>().getThreshold(strong).returnVal() == 3);

         THEN("Alice/bob has not minted any NFTs")
         {
            CHECK(getNfts(t, alice.id) == 0);
            CHECK(getNfts(t, bob.id) == 0);
         }

         THEN("Anyone can stage a tx for alice/bob")
         {
            auto proposeBob = rando.to<StagedTxService>().propose(proposed(bob.id), true);
            REQUIRE(proposeBob.succeeded());
            REQUIRE(getNfts(t, bob.id) == 0);
            auto proposeBobId = proposeBob.returnVal();

            auto proposeAlice = rando.to<StagedTxService>().propose(proposed(alice.id), true);
            REQUIRE(proposeAlice.succeeded());
            REQUIRE(getNfts(t, alice.id) == 0);
            auto proposeAliceId = proposeAlice.returnVal();

            AND_WHEN("Two producers accept bob's transaction")
            {
               auto txid = rando.to<StagedTxService>().get_staged_tx(proposeBobId).returnVal().txid;
               auto accept =
                   dana.with({dana_keys}).to<StagedTxService>().accept(proposeBobId, txid);
               REQUIRE(accept.succeeded());
               CHECK(getNfts(t, bob.id) == 0);

               auto accept2 =
                   elena.with({elena_keys}).to<StagedTxService>().accept(proposeBobId, txid);
               REQUIRE(accept2.succeeded());

               THEN("Bob (dependent on prods-weak) threshold was reached, so has minted an NFT")
               {
                  CHECK(getNfts(t, bob.id) == 1);
                  REQUIRE(rando.to<StagedTxService>()
                              .get_staged_tx(proposeBobId)
                              .failed("Unknown staged tx"));
               }
            }

            AND_WHEN("Two producers accepts alice's transaction")
            {
               auto txid =
                   rando.to<StagedTxService>().get_staged_tx(proposeAliceId).returnVal().txid;
               auto accept =
                   dana.with({dana_keys}).to<StagedTxService>().accept(proposeAliceId, txid);
               REQUIRE(accept.succeeded());
               auto accept2 =
                   elena.with({elena_keys}).to<StagedTxService>().accept(proposeAliceId, txid);
               REQUIRE(accept2.succeeded());

               THEN(
                   "Alice (dependent on prods-strong) threshold was not reached, so has not minted "
                   "an NFT")
               {
                  CHECK(getNfts(t, alice.id) == 0);
               }

               AND_WHEN("A third producer accepts alice's transaction")
               {
                  auto accept3 =
                      frank.with({frank_keys}).to<StagedTxService>().accept(proposeAliceId, txid);
                  REQUIRE(accept3.succeeded());
                  THEN(
                      "Alice (dependent on prods-strong) threshold was reached, so has minted an "
                      "NFT")
                  {
                     CHECK(getNfts(t, alice.id) == 1);
                     REQUIRE(rando.to<StagedTxService>()
                                 .get_staged_tx(proposeAliceId)
                                 .failed("Unknown staged tx"));
                  }
               }
            }
         }
      }
   }
}
