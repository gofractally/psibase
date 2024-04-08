#include <psibase/cft.hpp>

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

using node_type = node<null_link, mock_routing, cft_consensus, ForkDb>;

TEST_CASE("cft crash", "[cft]")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<CftConsensus>(nodes, {"a", "b", "c"});

   timer_type    timer(ctx);
   global_random rng;
   loop(timer, 10s, [&]() { nodes.partition(NetworkPartition::subset(rng)); });
   // This should result in a steady stream of empty blocks
   runFor(ctx, 5min);
   timer.cancel();
   ctx.poll();

   PSIBASE_LOG(logger, info) << "Final sync";
   // Make all nodes active
   nodes.connect_all();
   runFor(ctx, 10s);

   auto final_state = nodes[0].chain().get_head_state();
   // Verify that all three chains are consistent
   CHECK(final_state->blockId() == nodes[1].chain().get_head_state()->blockId());
   CHECK(final_state->blockId() == nodes[2].chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum == final_state->info.header.blockNum - 2);
}

std::vector<std::tuple<std::vector<std::string_view>, std::size_t>> cft_quorum = {
    {{"a"}, 1},
    {{"a", "b"}, 2},
    {{"a", "b", "c"}, 2},
    {{"a", "b", "c", "d"}, 3},
    {{"a", "b", "c", "d", "e"}, 3},
    {{"a", "b", "c", "d", "e", "f"}, 4},
    {{"a", "b", "c", "d", "e", "f", "g"}, 4},
};

TEST_CASE("cft quorum", "[cft]")
{
   TEST_START(logger);

   auto dataIndex = GENERATE_INDEX(cft_quorum);
   INFO("data-index: " << dataIndex);
   auto [prods, count] = cft_quorum.at(dataIndex);
   auto activeProds    = prods;
   activeProds.resize(count);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<CftConsensus>(nodes, prods);
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

TEST_CASE("cft partition", "[cft]")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<CftConsensus>(nodes, {"a", "b", "c", "d"});

   timer_type    timer(ctx);
   global_random rng;
   loop(timer, 20s, [&]() { nodes.partition(NetworkPartition::split(rng)); });
   // This may advance the chain, because some information is propagated
   // between nodes as the network is repartitioned, but since a quorum is
   // never simultaneously connected, the chain should not be expected
   // to advance.
   runFor(ctx, 10min);
   ctx.poll();
   timer.cancel();
   ctx.poll();

   PSIBASE_LOG(logger, info) << "Final sync";
   // Make all nodes active
   nodes.connect_all();
   runFor(ctx, 20s);

   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum >= final_state->info.header.blockNum - 2);
}
