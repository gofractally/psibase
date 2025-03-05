#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
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

   auto alice_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
                          "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
                           "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
                           "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
                           "-----END PRIVATE KEY-----\n")};

   auto bob_keys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
                          "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEbcmTuUFGjyAn0zd\n"
                           "7VKhIDZpswsI3m/5bMV+XoBQNTGhRANCAAQzeyU+Sa3KSwreirHYVfyB0jNMaNWt\n"
                           "GjyjVxTbjHHHyq96f3lqGlbApIe9u1CUDng/qlj0jGbuz5sOeeIY/DWJ\n"
                           "-----END PRIVATE KEY-----\n")};

   //{"data": {"userNfts":{"edges":[{"node":{"id":2,"issuer":"alice","owner":"alice"}}]}}}
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

// Tx can be staged on behalf of an account using auth-sig
// Tx is executed once the staged tx sender accepts it
// Tx is deleted without execution once tx sender rejects it
SCENARIO("AuthSig")
{
   GIVEN("Regular chain")
   {
      DefaultTestChain t;

      auto charlie = t.from(t.addAccount("charlie"_a));
      auto alice   = t.from(t.addAccount("alice"_a)).with({alice_keys});
      t.setAuth<AuthSig::AuthSig>(alice.id, alice_keys.first);
      auto bob = t.from(t.addAccount("bob"_a)).with({bob_keys});
      t.setAuth<AuthSig::AuthSig>(bob.id, bob_keys.first);

      auto mint         = Action{.sender  = alice.id,
                                 .service = Nft::service,
                                 .method  = "mint"_m,
                                 .rawData = psio::to_frac(std::tuple())

      };
      auto proposedMint = std::vector<Action>{mint};

      auto creditNft = [](auto sender, auto receiver, auto nftId)
      {
         return Action{
             .sender  = sender,
             .service = Nft::service,
             .method  = "credit"_m,
             .rawData = psio::to_frac(std::tuple(nftId, receiver, psibase::Memo{"Memo"}))};
      };

      auto getNfts = [](DefaultTestChain& t, AccountNumber acc) -> std::vector<uint32_t>
      {
         std::string query_str = "query UserNfts { userNfts( user: \"" + acc.str() +
                                 "\" ) { edges { node { id issuer owner } } } "
                                 "}";
         std::string_view query_sv = query_str;

         auto query = GraphQLBody{query_sv};

         std::cout << "Querying: " << std::string(query_sv) << "\n";
         auto res = t.post(Nft::service, "/graphql", query);

         auto body = std::string(res.body.begin(), res.body.end());
         std::cout << "Response: " << body << "\n";
         auto response_root = psio::convert_from_json<QueryRoot>(body);

         return response_root.data.userNfts.edges |
                std::views::transform([](auto edge) { return edge.node.id; }) |
                std::ranges::to<std::vector>();
      };

      THEN("Alice has not minted any NFTs")
      {
         CHECK(getNfts(t, alice.id).size() == 0);
      }
      THEN("Alice can self-stage a tx, which auto-executes")
      {
         auto propose = alice.to<StagedTxService>().propose(proposedMint, true);
         REQUIRE(propose.succeeded());
         REQUIRE(getNfts(t, alice.id).size() == 1);
      }
      THEN("Bob can stage a tx for alice, which does not auto-execute")
      {
         auto propose = bob.to<StagedTxService>().propose(proposedMint, true);
         REQUIRE(propose.succeeded());
         REQUIRE(getNfts(t, alice.id).size() == 0);
      }
      WHEN("Bob stages a tx for alice")
      {
         auto id   = bob.to<StagedTxService>().propose(proposedMint, true).returnVal();
         auto txid = bob.to<StagedTxService>().get_staged_tx(id).returnVal().txid;

         THEN("Alice can accept it, executing it")
         {
            auto accept = alice.to<StagedTxService>().accept(id, txid);
            REQUIRE(accept.succeeded());
            REQUIRE(getNfts(t, alice.id).size() == 1);
         }
         THEN("Alice can reject it, deleting it")
         {
            auto reject = alice.to<StagedTxService>().reject(id, txid);
            REQUIRE(reject.succeeded());
            REQUIRE(getNfts(t, alice.id).size() == 0);
            REQUIRE(alice.to<StagedTxService>().get_staged_tx(id).failed("Unknown staged tx"));
         }
      }

      // Test atomic swaps
      WHEN("Alice and Bob have NFTs")
      {
         auto aliceMint = alice.to<Nft>().mint();
         auto bobMint   = bob.to<Nft>().mint();
         REQUIRE(aliceMint.succeeded());
         REQUIRE(bobMint.succeeded());
         auto aliceNfts = getNfts(t, alice.id);
         REQUIRE(aliceNfts.size() == 1);
         auto bobNfts = getNfts(t, bob.id);
         REQUIRE(bobNfts.size() == 1);

         auto aliceNftId = aliceMint.returnVal();
         auto bobNftId   = bobMint.returnVal();
         REQUIRE(aliceNfts[0] == aliceNftId);
         REQUIRE(bobNfts[0] == bobNftId);

         AND_WHEN("Alice proposes a swap")
         {
            auto proposed = alice.to<StagedTxService>().propose(
                std::vector<Action>{
                    creditNft(alice.id, bob.id, aliceNftId),  //
                    creditNft(bob.id, alice.id, bobNftId)     //
                },
                true);
            REQUIRE(proposed.succeeded());
            auto id = proposed.returnVal();

            THEN("The swap does not immediately execute")
            {
               REQUIRE(getNfts(t, alice.id) == std::vector{aliceNftId});
            }

            THEN("Bob can accept the swap")
            {
               auto txid   = bob.to<StagedTxService>().get_staged_tx(id).returnVal().txid;
               auto accept = bob.to<StagedTxService>().accept(id, txid);
               REQUIRE(accept.succeeded());

               AND_THEN("The atomic swap is complete")
               {
                  REQUIRE(getNfts(t, alice.id) == std::vector{bobNftId});
                  REQUIRE(getNfts(t, bob.id) == std::vector{aliceNftId});
               }
            }
         }
      }
   }
}
