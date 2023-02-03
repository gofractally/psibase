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

   auto [prods, count] = GENERATE(from_range(bft_quorum));
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
   ctx.poll();
   timer.cancel();
   ctx.poll();

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

   auto latency = GENERATE(150ms, 450ms, 900ms, 1050ms, 2100ms, 3450ms, 7650ms, 10350ms, 15450ms);

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
