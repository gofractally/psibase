#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/StagedTx.hpp>
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

   auto pub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto priv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
       "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
       "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
       "-----END PRIVATE KEY-----\n");

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

// Tx can be staged on behalf of an account using auth-delegate
// Tx is executed once the owner accepts it
// Tx is deleted without execution if owner rejects it
SCENARIO("AuthDelegate")
{
   GIVEN("Regular chain")
   {
      DefaultTestChain t;

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto charlie = t.from(t.addAccount("charlie"_a));
      auto dana    = t.from(t.addAccount("dana"_a));

      REQUIRE(alice.to<AuthDelegate>().setOwner("bob"_a).succeeded());
      REQUIRE(alice.to<Accounts>().setAuthServ(AuthDelegate::service).succeeded());

      t.setAuth<AuthSig::AuthSig>(dana.id, pub);
      auto keys = KeyList{{pub, priv}};

      auto mintAction = Action{.sender  = alice.id,
                               .service = Nft::service,
                               .method  = "mint"_m,
                               .rawData = psio::to_frac(std::tuple())

      };
      auto proposed   = std::vector<Action>{mintAction};

      auto aliceNfts = [&]()
      {
         auto query = GraphQLBody{
             "query UserNfts { userNfts( user: \"alice\" ) { edges { node { id issuer owner } } } "
             "}"};

         auto res = t.post(Nft::service, "/graphql", query);

         auto body          = std::string(res.body.begin(), res.body.end());
         auto response_root = psio::convert_from_json<QueryRoot>(body);

         return response_root.data.userNfts.edges.size();
      };

      THEN("Alice has not minted any NFTs")
      {
         CHECK(aliceNfts() == 0);
      }
      THEN("Bob can stage a tx for alice, which auto-executes")
      {
         auto propose = bob.to<StagedTxService>().propose(proposed, true);
         REQUIRE(propose.succeeded());
         REQUIRE(aliceNfts() == 1);
      }
      WHEN("Bob uses auth-sig")
      {
         t.setAuth<AuthSig::AuthSig>(bob.id, pub);

         THEN("Charlie can stage a tx for alice, which does not auto-execute")
         {
            auto propose = charlie.to<StagedTxService>().propose(proposed, true);
            REQUIRE(propose.succeeded());
            REQUIRE(aliceNfts() == 0);
         }
         WHEN("Charlie stages a tx for alice")
         {
            auto id   = charlie.to<StagedTxService>().propose(proposed, true).returnVal();
            auto txid = charlie.to<StagedTxService>().get_staged_tx(id).returnVal().txid;

            THEN("Bob can accept it, executing it")
            {
               auto accept = bob.with(keys).to<StagedTxService>().accept(id, txid);
               REQUIRE(accept.succeeded());
               REQUIRE(aliceNfts() == 1);
            }
            THEN("Bob can reject it, deleting it")
            {
               auto reject = bob.with(keys).to<StagedTxService>().reject(id, txid);
               REQUIRE(reject.succeeded());
               REQUIRE(aliceNfts() == 0);
               REQUIRE(bob.with(keys).to<StagedTxService>().get_staged_tx(id).failed(
                   "Unknown staged tx"));
            }
         }
      }
      AND_WHEN("Bob delegates account to dana")
      {
         REQUIRE(bob.to<AuthDelegate>().setOwner("dana"_a).succeeded());
         REQUIRE(bob.to<Accounts>().setAuthServ(AuthDelegate::service).succeeded());

         THEN("Charlie can stage a tx for alice, which does not auto-execute")
         {
            auto propose = charlie.to<StagedTxService>().propose(proposed, true);
            REQUIRE(propose.succeeded());
            REQUIRE(aliceNfts() == 0);
         }
         WHEN("Charlie stages a tx for alice")
         {
            auto id   = charlie.to<StagedTxService>().propose(proposed, true).returnVal();
            auto txid = charlie.to<StagedTxService>().get_staged_tx(id).returnVal().txid;

            THEN("Dana can accept it, executing it")
            {
               auto accept = dana.with(keys).to<StagedTxService>().accept(id, txid);
               REQUIRE(accept.succeeded());
               REQUIRE(aliceNfts() == 1);
            }
            THEN("Dana can reject it, deleting it")
            {
               auto reject = dana.with(keys).to<StagedTxService>().reject(id, txid);
               REQUIRE(reject.succeeded());
               REQUIRE(aliceNfts() == 0);
               REQUIRE(dana.with(keys).to<StagedTxService>().get_staged_tx(id).failed(
                   "Unknown staged tx"));
            }
         }
      }
   }
}
