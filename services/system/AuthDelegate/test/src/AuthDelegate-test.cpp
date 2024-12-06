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
      REQUIRE(alice.to<AuthDelegate>().setOwner("bob"_a).succeeded());
      REQUIRE(alice.to<Accounts>().setAuthServ(AuthDelegate::service).succeeded());

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
         auto propose = bob.to<StagedTxService>().propose(proposed);
         REQUIRE(propose.succeeded());
         REQUIRE(aliceNfts() == 1);
      }
      THEN("Charlie can stage a tx for alice, which does not auto-execute")
      {
         auto propose = charlie.to<StagedTxService>().propose(proposed);
         REQUIRE(propose.succeeded());
         REQUIRE(aliceNfts() == 0);
      }
      WHEN("Charlie stages a tx for alice")
      {
         auto id   = charlie.to<StagedTxService>().propose(proposed).returnVal();
         auto txid = charlie.to<StagedTxService>().get_staged_tx(id).returnVal().txid;

         THEN("Bob can accept it, executing it")
         {
            auto accept = bob.to<StagedTxService>().accept(id, txid);
            REQUIRE(accept.succeeded());
            REQUIRE(aliceNfts() == 1);
         }
         THEN("Bob can reject it, deleting it")
         {
            auto reject = bob.to<StagedTxService>().reject(id, txid);
            REQUIRE(reject.succeeded());
            REQUIRE(aliceNfts() == 0);
            REQUIRE(bob.to<StagedTxService>().get_staged_tx(id).failed("Unknown staged tx"));
         }
      }
   }
}