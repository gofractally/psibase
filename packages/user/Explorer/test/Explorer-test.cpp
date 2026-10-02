#include <services/user/Explorer.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/user/Nop.hpp>

using namespace psibase;
using namespace UserService;
using namespace SystemService;

struct BlocksAction
{
   AccountNumber sender;
   AccountNumber service;
   MethodNumber  method;
   PSIO_REFLECT(BlocksAction, sender, service, method)
};
struct BlocksTransaction
{
   std::vector<BlocksAction> actions;
   PSIO_REFLECT(BlocksTransaction, actions)
};
struct BlocksSignedTransaction
{
   BlocksTransaction transaction;
   PSIO_REFLECT(BlocksSignedTransaction, transaction)
};
struct BlocksNode
{
   std::vector<BlocksSignedTransaction> transactions;
   PSIO_REFLECT(BlocksNode, transactions)
};
struct BlocksEdge
{
   BlocksNode node;
   PSIO_REFLECT(BlocksEdge, node)
};
struct BlocksBlocks
{
   std::vector<BlocksEdge> edges;
   PSIO_REFLECT(BlocksBlocks, edges)
};
struct BlocksData
{
   BlocksBlocks blocks;
   PSIO_REFLECT(BlocksData, blocks)
};
struct BlocksRoot
{
   BlocksData data;
   PSIO_REFLECT(BlocksRoot, data)
};

TEST_CASE("test authenticated user")
{
   DefaultTestChain t;

   auto        alice = t.addAccount("alice");
   auto        bob   = t.addAccount("bob");
   std::string token = t.login(alice, Explorer::service);

   t.setAutoBlockStart(false);
   REQUIRE(t.from(alice).to<Nop>().nop().succeeded());
   REQUIRE(t.from(bob).to<Nop>().nop().succeeded());
   t.finishBlock();

   std::string_view query =
       "query { blocks(last: 1) { edges { node { transactions { transaction { actions { service "
       "sender method } } } } } } }";

   {
      auto reply = t.post<BlocksRoot>(Explorer::service, "/graphql", GraphQLBody{query});
      REQUIRE(reply.data.blocks.edges.size() == 1);
      REQUIRE(reply.data.blocks.edges[0].node.transactions.size() == 0);
   }
   {
      auto reply = t.post<BlocksRoot>(Explorer::service, "/graphql", GraphQLBody{query}, token);
      REQUIRE(reply.data.blocks.edges.size() == 1);
      REQUIRE(reply.data.blocks.edges[0].node.transactions.size() == 1);
      REQUIRE(reply.data.blocks.edges[0].node.transactions[0].transaction.actions.size() == 1);
      auto act = reply.data.blocks.edges[0].node.transactions[0].transaction.actions[0];
      CHECK(act.sender == alice);
      CHECK(act.service == Nop::service);
      CHECK(act.method == MethodNumber{"nop"});
   }
}
