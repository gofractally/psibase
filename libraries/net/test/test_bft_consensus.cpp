#include <psibase/bft.hpp>

#include <psibase/fork_database.hpp>
#include <psibase/log.hpp>
#include <psibase/mock_routing.hpp>
#include <psibase/mock_timer.hpp>
#include <psibase/node.hpp>

#include <boost/asio/io_context.hpp>

#include <filesystem>
#include <random>

#include <catch2/catch.hpp>

#include "test_util.hpp"

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;
using namespace std::literals::chrono_literals;

using node_type = node<null_link, mock_routing, bft_consensus, ForkDb>;

TEST_CASE("bft crash", "[bft]")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   auto                    work = boost::asio::make_work_guard(ctx);
   NodeSet<node_type>      nodes(ctx);

   setup<BftConsensus>(nodes, {"a", "b", "c", "d"});

   timer_type    timer(ctx);
   global_random rng;
   loop(timer, 10s, [&]() { nodes.partition(NetworkPartition::subset(rng, 0.67)); });
   // This should result in a steady stream of empty blocks
   runFor(ctx, 5min);
   ctx.poll();
   timer.cancel();
   ctx.poll();

   PSIBASE_LOG(logger, info) << "Final sync";
   // Make all nodes active
   nodes.connect_all();
   runFor(ctx, 20s);

   auto final_state = nodes[0].chain().get_head_state();
   // Verify that all chains are consistent
   CHECK(final_state->blockId() == nodes[1].chain().get_head_state()->blockId());
   CHECK(final_state->blockId() == nodes[2].chain().get_head_state()->blockId());
   CHECK(final_state->blockId() == nodes[3].chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum == final_state->info.header.blockNum - 2);
}

std::vector<std::tuple<std::vector<std::string_view>, std::size_t>> bft_quorum = {
    {{"a"}, 1},
    {{"a", "b"}, 2},
    {{"a", "b", "c"}, 3},
    {{"a", "b", "c", "d"}, 3},
    {{"a", "b", "c", "d", "e"}, 4},
    {{"a", "b", "c", "d", "e", "f"}, 5},
    {{"a", "b", "c", "d", "e", "f", "g"}, 5},
};

TEST_CASE("bft quorum", "[bft]")
{
   TEST_START(logger);

   auto dataIndex = GENERATE_INDEX(bft_quorum);
   INFO("data-index: " << dataIndex);
   auto [prods, count] = bft_quorum.at(dataIndex);
   auto activeProds    = prods;
   activeProds.resize(count);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<BftConsensus>(nodes, prods);
   nodes.partition(activeProds);
   runFor(ctx, 20s);

   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
   {
      if (count == 1 || !node->node.network()._peers.empty())
         CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
      else
         CHECK(node->chain().get_head_state()->blockId() == Checksum256{});
   }
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum >= final_state->info.header.blockNum - 2);
}

TEST_CASE("bft partition", "[bft]")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<BftConsensus>(nodes, {"a", "b", "c", "d"});

   timer_type    timer(ctx);
   global_random rng;
   loop(timer, 15s, [&]() { nodes.partition(NetworkPartition::split(rng)); });
   // This may advance the chain, but should not be expected to
   runFor(ctx, 10min);
   timer.cancel();
   ctx.poll();
   ctx.restart();

   PSIBASE_LOG(logger, info) << "Final sync";
   // Make all nodes active
   nodes.connect_all();
   runFor(ctx, 30s);

   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum >= final_state->info.header.blockNum - 2);
}

TEST_CASE("bft latency", "[bft]")
{
   TEST_START(logger);

   static const std::vector latencies{150ms,  450ms,  900ms,   1050ms, 2100ms,
                                      3450ms, 7650ms, 10350ms, 15450ms};
   auto                     dataIndex = GENERATE_INDEX(latencies);
   INFO("data-index: " << dataIndex);
   auto latency = latencies.at(dataIndex);

   INFO("latency: " << latency.count() << " ms");

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   auto                    producers = makeAccounts({"a", "b", "c", "d"});
   nodes.add(producers);
   nodes.partition(NetworkPartition::all(), latency);
   boot<BftConsensus>(nodes.getBlockContext(), producers);

   runFor(ctx, 5min);

   // The producers are not guaranteed to be perfectly in sync
   for (const auto& node : nodes.nodes)
   {
      auto final_state = node->chain().get_head_state();
      // Verify that the final block looks sane
      mock_clock::time_point final_time{
          std::chrono::seconds{final_state->info.header.time.seconds}};
      CHECK(final_time <= mock_clock::now());
      CHECK(final_time >= mock_clock::now() - 2s - latency);
      auto irreversible = node->chain().get_block_by_num(final_state->info.header.commitNum);
      mock_clock::time_point irreversible_time{
          std::chrono::seconds{irreversible->block().header().time().seconds()}};
      CHECK(final_time - irreversible_time >= 3 * latency);
      CHECK(final_time - irreversible_time <= 3 * latency + 2s);
   }
   // Check consistency
   for (const auto& node1 : nodes.nodes)
   {
      auto commit1 = node1->chain().commit_index();
      for (const auto& node2 : nodes.nodes)
      {
         auto commit2    = node2->chain().commit_index();
         auto min_commit = std::min(commit1, commit2);
         CHECK(node1->chain().get_block_id(min_commit) == node1->chain().get_block_id(min_commit));
      }
   }
}

TEST_CASE("commit before prepare", "[bft]")
{
   TEST_START(logger);
   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   auto                    producers = makeAccounts({"a", "b", "c", "d"});
   nodes.add(makeAccounts({"a", "e"}));
   nodes.partition(NetworkPartition::all());
   boot<BftConsensus>(nodes.getBlockContext(), producers);
   runFor(ctx, 1s);

   auto send = [&](auto&& message)
   {
      nodes[1].sendto(AccountNumber{"a"}, message);
      ctx.poll();
   };
   auto boot_block = nodes[0].chain().get_head_state()->info;

   auto block1 = makeBlock(boot_block, "b", 4);
   auto block2 = makeBlock(boot_block, "c", 5);
   send(block1);
   send(block2);

   send(makeCommit(block2, "b"));
   send(makeCommit(block2, "c"));
   send(makeCommit(block2, "d"));
   send(makePrepare(block1, "b"));
   send(makePrepare(block1, "c"));
   send(makePrepare(block1, "d"));
}

TEST_CASE("view change update head", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   auto                  boot_block = node.head();
   auto                  block1     = makeBlock(boot_block, "b", 4);
   node.send(block1);
   CHECK(node.head().blockId == boot_block.blockId);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   CHECK(node.head().blockId == BlockInfo{block1.block->block()}.blockId);
}

//     ------- B
// root
//     --- A ----- X
TEST_CASE("fork before invalid 1", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   // The final block is ordered between the parent of the
   // invalid block and the invalid block
   auto root    = node.head();
   auto block1  = makeBlock(root, "b", 4);
   auto block2  = makeBlock(root, "c", 5);
   auto invalid = makeBlock(block1, "d", 6, Transaction{.actions = {Action{}}});
   node.send(block1);
   node.send(block2);
   node.send(invalid);
   node.send(makeViewChange("b", 6));
   node.send(makeViewChange("d", 6));
   CHECK(node.head().blockId == BlockInfo{block2.block->block()}.blockId);
}

//     ------- B
// root
//     --- X ----- A
TEST_CASE("fork before invalid 2", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   // The final block is ordered between the invalid block
   // and a descendant of the invalid block
   auto root    = node.head();
   auto invalid = makeBlock(root, "b", 4, Transaction{.actions = {Action{}}});
   auto block1  = makeBlock(root, "c", 5);
   auto block2  = makeBlock(invalid, "d", 6);
   node.send(invalid);
   node.send(block1);
   node.send(block2);
   node.send(makeViewChange("b", 6));
   node.send(makeViewChange("d", 6));
   CHECK(node.head().blockId == BlockInfo{block1.block->block()}.blockId);
}

//     --- A --- B
// root
//     ------------ C --- X
//
// This test switches from B to C in between sending A and B to a peer.
TEST_CASE("truncated fork switch", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   //
   auto root    = node.head();
   auto block1a = makeBlock(root, "b", 4);
   auto block1b = makeBlock(block1a, "b", 4);
   auto block1c = makeBlock(block1b, "b", 4);
   auto block2  = makeBlock(root, "c", 5, setProducers(bft("a", "b", "c", "e")));
   auto invalid = makeBlock(block2, "c", 5, Transaction{.actions = {Action{}}});
   node.addClient();
   node.send(block1a);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   node.send0(block1b);
   node.send0(block1c);
   node.send0(block2);
   node.send0(invalid);
   node.send0(makeViewChange("b", 5));
   node.send0(makeViewChange("c", 5));
   node.poll();
   CHECK(node.head().blockId == BlockInfo{block2.block->block()}.blockId);
}

//           --- B
// root --- X
//           --- A
TEST_CASE("fork after invalid", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   // If there are multiple forks that descend from an invalid
   // block, they should all get blacklisted.
   auto root    = node.head();
   auto invalid = makeBlock(root, "b", 4, Transaction{.actions = {Action{}}});
   auto block1  = makeBlock(invalid, "b", 4);
   auto block2  = makeBlock(invalid, "c", 5);
   node.send(invalid);
   node.send(block1);
   node.send(block2);
   node.send(makeViewChange("b", 5));
   node.send(makeViewChange("c", 5));
   CHECK(node.head().blockId == root.blockId);
}

//     --- A --- X
// root
//     ------------ B --- P
TEST_CASE("producer fork 1", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto fork1   = makeBlock(root, "b", 4);
   auto invalid = makeBlock(fork1, "b", 4, Transaction{.actions = {Action{}}});
   // start block production for "a"
   node.send(makeViewChange("b", 7));
   node.send(makeViewChange("c", 7));
   CHECK(!!node.nodes[0].chain().getBlockContext());
   runFor(node.ctx, 1s);
   node.send(fork1);
   node.send(invalid);
   // Force switch to fork 1
   BlockInfo fork1info{fork1.block->block()};
   node.send(makeViewChange("b", 11, fork1info, {"b", "c", "d"}));
   node.send(makeViewChange("c", 11, fork1info, {"b", "c", "d"}));
   node.send(makeViewChange("d", 11, fork1info, {"b", "c", "d"}));
   CHECK(node.head().blockId == fork1info.blockId);
   runFor(node.ctx, 1s);
   // The block should be built off fork1
   CHECK(node.head().header.previous == fork1info.blockId);
   CHECK(node.head().header.producer.str() == "a");
}

//     ------ B --- X
// root
//     --- A --- P
TEST_CASE("producer cancel fork switch")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto fork1   = makeBlock(root, "b", 4);
   auto fork2   = makeBlock(root, "c", 5);
   auto invalid = makeBlock(fork2, "a", 7, Transaction{.actions = {Action{}}});
   node.send(fork1);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   // start block production for "a"
   node.send(makeViewChange("b", 7));
   node.send(makeViewChange("c", 7));
   // We should not switch forks, because the pending block is better fork2
   node.send(fork2);
   CHECK(node.head().blockId == BlockInfo{fork1.block->block()}.blockId);
   // We should still not switch forks, because invalid gets discarded after it fails
   node.send(invalid);
   CHECK(node.head().blockId == BlockInfo{fork1.block->block()}.blockId);
   // The next block should be built off fork1
   runFor(node.ctx, 1s);
   CHECK(node.head().header.previous == BlockInfo{fork1.block->block()}.blockId);
   CHECK(node.head().header.producer.str() == "a");
}

TEST_CASE("better block after commit", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});
   // fork2 should be excluded after fork1 is prepared
   auto root  = node.head();
   auto fork1 = makeBlock(root, "b", 4);
   auto fork2 = makeBlock(root, "c", 5);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   node.send(fork1);
   node.send(makePrepare(fork1, "b"));
   node.send(makePrepare(fork1, "c"));
   node.send(makeViewChange("b", 5));
   node.send(makeViewChange("c", 5));
   node.send(fork2);
   CHECK(node.head().blockId == BlockInfo{fork1.block->block()}.blockId);
}

TEST_CASE("return to previous fork", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root   = node.head();
   auto fork1  = makeBlock(root, "b", 4);
   auto fork2  = makeBlock(root, "c", 5);
   auto fork1b = makeBlock(fork1, "b", 4);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   node.send(fork1);
   node.send(makeViewChange("b", 5));
   node.send(makeViewChange("c", 5));
   node.send(fork2);
   CHECK(node.head().blockId == BlockInfo{fork2.block->block()}.blockId);
   // return to the worse fork
   node.send(fork1b);
   node.send(makeViewChange("b", 6, BlockInfo{fork1.block->block()}, {"b", "c", "d"}));
   node.send(makeViewChange("c", 6, BlockInfo{fork1.block->block()}, {"b", "c", "d"}));
   node.send(makePrepare(fork1b, "b"));
   node.send(makePrepare(fork1b, "c"));
   CHECK(node.head().blockId == BlockInfo{fork1b.block->block()}.blockId);
   // Must not generate commit for fork1b because this conflicts
   // with the view change.  Note that c's commit also violates
   // the protocol, so we have to consider it to be the one adversary node..
   node.send(makeCommit(fork1b, "c"));
   node.send(makeCommit(fork1b, "d"));

   node.send(makeViewChange("b", 7, BlockInfo{fork2.block->block()}, {"b", "c", "d"}));
   node.send(makeViewChange("c", 7, BlockInfo{fork2.block->block()}, {"b", "c", "d"}));

   // should switch to fork 2
   CHECK(node.head().blockId == BlockInfo{fork2.block->block()}.blockId);
}

TEST_CASE("new consensus at view change", "[bft]")
{
   TEST_START(logger);
   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<BftConsensus>(nodes, {"a", "b", "c", "d"});
   runFor(nodes.ctx, 1s);
   nodes.partition(NetworkPartition{});
   // This should be long enough to trigger a view change
   runFor(nodes.ctx, 15s);
   nodes.partition(NetworkPartition::all());
   // Advance in increments of 1s to ensure that the first block
   // in the new view contains the new producers.
   nodes.ctx.poll();
   while (true)
   {
      if (auto ctx = nodes.getBlockContext())
      {
         setProducers(ctx, bft("e", "f", "g", "h"));
         runFor(nodes.ctx, 1s);
         break;
      }
      assert(!"Actually, the producers should come to an agreement immediately");
      runFor(nodes.ctx, 1s);
   }
   // Verify that the test case is actually testing the condition
   // that we want to test.
   REQUIRE(!!nodes[0].chain().get_head()->newConsensus);
   REQUIRE(nodes[0].chain().get_head()->term >
           nodes[0].chain().get_state((nodes[0].chain().get_head()->previous))->info.header.term);

   nodes.add(makeAccounts({"e", "f", "g", "h"}));
   nodes.partition(NetworkPartition::all());
   runFor(nodes.ctx, 30s);

   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
}

// -----------------------------------------------------
// The following test cases excercise messages sequences
// in which more than f producers violate the protocol.
// While the protocol specifies that the result is
// undefined, a node should not crash.
// -----------------------------------------------------

// The invalid block is attempted and flagged before the fork switch
TEST_CASE("invalid prepared block 1", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto invalid = makeBlock(root, "b", 4, Transaction{.actions = {Action{}}});
   node.send(invalid);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   node.send(makePrepare(invalid, "b"));
   node.send(makePrepare(invalid, "c"));
   try
   {
      node.send(makePrepare(invalid, "d"));
   }
   catch (consensus_failure&)
   {
   }
}

// The invalid block is executed at the fork switch
TEST_CASE("invalid prepared block 2", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto invalid = makeBlock(root, "b", 4, Transaction{.actions = {Action{}}});
   auto block1  = makeBlock(root, "c", 5);
   node.send(block1);
   node.send(makeViewChange("b", 5));
   node.send(makeViewChange("c", 5));
   node.send(invalid);
   node.send(makePrepare(invalid, "b"));
   node.send(makePrepare(invalid, "c"));
   try
   {
      node.send(makePrepare(invalid, "d"));
   }
   catch (consensus_failure&)
   {
   }
}

TEST_CASE("invalid committed block", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto invalid = makeBlock(root, "b", 4, Transaction{.actions = {Action{}}});
   node.send(invalid);
   node.send(makeViewChange("b", 4));
   node.send(makeViewChange("c", 4));
   node.send(makeCommit(invalid, "b"));
   node.send(makeCommit(invalid, "c"));
   CHECK_THROWS_AS(node.send(makeCommit(invalid, "d")), consensus_failure);
}

TEST_CASE("double commit 1", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root   = node.head();
   auto block1 = makeBlock(root, "b", 4);
   auto block2 = makeBlock(root, "c", 5);
   node.send(block1);
   node.send(block2);

   node.send(makeCommit(block1, "b"));
   node.send(makeCommit(block1, "c"));
   node.send(makeCommit(block1, "d"));

   node.send(makeCommit(block2, "b"));
   node.send(makeCommit(block2, "c"));
   // At the time of writing, this throws. However, if block2 is
   // pruned, the commits will simply be ignored.
   try
   {
      node.send(makeCommit(block2, "d"));
   }
   catch (consensus_failure&)
   {
   }
   CHECK(node.head().blockId == BlockInfo{block1.block->block()}.blockId);
}

TEST_CASE("double commit 2", "[bft]")
{
   TEST_START(logger);
   SingleNode<node_type> node({"a", "b", "c", "d"});

   auto root    = node.head();
   auto block1a = makeBlock(root, "b", 4);
   auto block1b = makeBlock(block1a, "b", 4);
   auto block2  = makeBlock(root, "c", 5);
   node.send(block1a);
   node.send(block1b);
   node.send(block2);

   node.send(makeCommit(block1b, "b"));
   node.send(makeCommit(block1b, "c"));
   node.send(makeCommit(block1b, "d"));

   node.send(makeCommit(block2, "b"));
   node.send(makeCommit(block2, "c"));
   // At the time of writing, this throws. However, if block2 is
   // pruned, the commits will simply be ignored.
   try
   {
      node.send(makeCommit(block2, "d"));
   }
   catch (consensus_failure&)
   {
   }
   CHECK(node.head().blockId == BlockInfo{block1b.block->block()}.blockId);
}
