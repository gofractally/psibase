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
   std::optional<BlocksTransaction> transaction;
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
      REQUIRE(reply.data.blocks.edges[0].node.transactions.size() == 3);
      for (const auto& tx : reply.data.blocks.edges[0].node.transactions)
      {
         REQUIRE(!tx.transaction.has_value());
      }
   }
   {
      auto reply = t.post<BlocksRoot>(Explorer::service, "/graphql", GraphQLBody{query}, token);
      REQUIRE(reply.data.blocks.edges.size() == 1);
      const auto& transactions = reply.data.blocks.edges[0].node.transactions;
      REQUIRE(transactions.size() == 3);
      CHECK(!transactions[0].transaction.has_value());
      CHECK(!transactions[2].transaction.has_value());
      REQUIRE(transactions[1].transaction.has_value());
      auto act = transactions[1].transaction->actions[0];
      CHECK(act.sender == alice);
      CHECK(act.service == Nop::service);
      CHECK(act.method == MethodNumber{"nop"});
   }
}

struct CountsTransaction
{
   std::string                      id;
   std::uint32_t                    numActions;
   std::optional<BlocksTransaction> transaction;
   PSIO_REFLECT(CountsTransaction, id, numActions, transaction)
};
struct ServiceCount
{
   AccountNumber service;
   std::uint32_t count;
   PSIO_REFLECT(ServiceCount, service, count)
};
struct CountsHeader
{
   BlockNum blockNum;
   PSIO_REFLECT(CountsHeader, blockNum)
};
struct CountsNode
{
   CountsHeader                   header;
   std::vector<ServiceCount>      actionsReceived;
   std::vector<CountsTransaction> transactions;
   PSIO_REFLECT(CountsNode, header, actionsReceived, transactions)
};
struct CountsEdge
{
   CountsNode node;
   PSIO_REFLECT(CountsEdge, node)
};
struct CountsBlocks
{
   std::vector<CountsEdge> edges;
   PSIO_REFLECT(CountsBlocks, edges)
};
struct CountsData
{
   CountsBlocks blocks;
   PSIO_REFLECT(CountsData, blocks)
};
struct CountsRoot
{
   CountsData data;
   PSIO_REFLECT(CountsRoot, data)
};

constexpr std::string_view countsQuery =
    "query { blocks(last: 1) { edges { node { header { blockNum } actionsReceived { service count "
    "} transactions { id numActions transaction { actions { service sender method } } } } } } }";

TEST_CASE("action counts are public")
{
   DefaultTestChain t;

   auto alice = t.addAccount("alice");
   auto bob   = t.addAccount("bob");

   t.finishBlock();
   t.setAutoBlockStart(false);
   REQUIRE(t.from(alice).to<Nop>().nop().succeeded());
   REQUIRE(t.from(bob).to<Nop>().nop().succeeded());
   t.finishBlock();

   auto reply = t.post<CountsRoot>(Explorer::service, "/graphql", GraphQLBody{countsQuery});
   REQUIRE(reply.data.blocks.edges.size() == 1);
   const auto& node = reply.data.blocks.edges[0].node;
   REQUIRE(node.transactions.size() == 3);

   std::uint32_t totalActions = 0;
   for (const auto& tx : node.transactions)
   {
      CHECK(!tx.transaction.has_value());
      CHECK(tx.numActions >= 1);
      totalActions += tx.numActions;
   }
   CHECK(node.transactions[1].numActions == 1);
   CHECK(node.transactions[2].numActions == 1);

   std::uint32_t totalReceived = 0;
   std::uint32_t nopReceived   = 0;
   for (const auto& entry : node.actionsReceived)
   {
      totalReceived += entry.count;
      if (entry.service == Nop::service)
         nopReceived = entry.count;
   }
   CHECK(totalReceived == totalActions);
   CHECK(nopReceived == 2);
}

struct LookupHeader
{
   BlockNum blockNum;
   PSIO_REFLECT(LookupHeader, blockNum)
};
struct LookupBlock
{
   std::vector<CountsTransaction> transactions;
   PSIO_REFLECT(LookupBlock, transactions)
};
struct LookupLocation
{
   BlockNum          blockNum;
   std::uint32_t     index;
   AccountNumber     producer;
   CountsTransaction transaction;
   PSIO_REFLECT(LookupLocation, blockNum, index, producer, transaction)
};
struct LookupData
{
   std::optional<LookupHeader>   head;
   std::optional<LookupHeader>   blockHeader;
   std::optional<LookupBlock>    block;
   std::optional<LookupLocation> transaction;
   PSIO_REFLECT(LookupData, head, blockHeader, block, transaction)
};
struct LookupRoot
{
   LookupData data;
   PSIO_REFLECT(LookupRoot, data)
};

TEST_CASE("block and transaction lookups")
{
   DefaultTestChain t;

   auto        alice = t.addAccount("alice");
   auto        bob   = t.addAccount("bob");
   std::string token = t.login(alice, Explorer::service);

   t.setAutoBlockStart(false);
   REQUIRE(t.from(alice).to<Nop>().nop().succeeded());
   REQUIRE(t.from(bob).to<Nop>().nop().succeeded());
   t.finishBlock();

   auto blocks = t.post<CountsRoot>(Explorer::service, "/graphql", GraphQLBody{countsQuery}, token);
   REQUIRE(blocks.data.blocks.edges.size() == 1);
   const auto& node     = blocks.data.blocks.edges[0].node;
   auto        blockNum = node.header.blockNum;
   REQUIRE(node.transactions.size() == 3);
   REQUIRE(node.transactions[1].transaction.has_value());
   auto aliceTxId = node.transactions[1].id;

   auto lookup = [&](const std::optional<std::string>& token)
   {
      std::string query = std::format(
          "query {{ head {{ blockNum }} blockHeader(blockNum: {0}) {{ blockNum }} block(blockNum: "
          "{0}) {{ transactions {{ id numActions }} }} transaction(id: \"{1}\") {{ blockNum index "
          "producer transaction {{ id numActions transaction {{ actions {{ service sender method "
          "}} }} }} }} }}",
          blockNum, aliceTxId);
      if (token)
         return t.post<LookupRoot>(Explorer::service, "/graphql", GraphQLBody{query}, *token);
      return t.post<LookupRoot>(Explorer::service, "/graphql", GraphQLBody{query});
   };

   {
      auto reply = lookup(std::nullopt);
      REQUIRE(reply.data.head.has_value());
      CHECK(reply.data.head->blockNum == blockNum);
      REQUIRE(reply.data.blockHeader.has_value());
      CHECK(reply.data.blockHeader->blockNum == blockNum);
      REQUIRE(reply.data.block.has_value());
      CHECK(reply.data.block->transactions.size() == 3);
      REQUIRE(reply.data.transaction.has_value());
      CHECK(reply.data.transaction->blockNum == blockNum);
      CHECK(reply.data.transaction->index == 1);
      CHECK(reply.data.transaction->transaction.id == aliceTxId);
      CHECK(reply.data.transaction->transaction.numActions == 1);
      CHECK(!reply.data.transaction->transaction.transaction.has_value());
   }
   {
      auto reply = lookup(token);
      REQUIRE(reply.data.transaction.has_value());
      REQUIRE(reply.data.transaction->transaction.transaction.has_value());
      auto act = reply.data.transaction->transaction.transaction->actions[0];
      CHECK(act.sender == alice);
      CHECK(act.service == Nop::service);
   }
   {
      std::string query =
          std::format("query {{ blockHeader(blockNum: {}) {{ blockNum }} transaction(id: \"{}\") "
                      "{{ index }} }}",
                      blockNum + 1000, std::string(64, '0'));
      auto reply = t.post<LookupRoot>(Explorer::service, "/graphql", GraphQLBody{query});
      CHECK(!reply.data.blockHeader.has_value());
      CHECK(!reply.data.transaction.has_value());
   }
}
