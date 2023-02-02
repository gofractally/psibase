#include <psibase/cft.hpp>

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

using node_type = node<null_link, mock_routing, cft_consensus, ForkDb>;

TEST_CASE("cft random connect/disconnect", "[cft]")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);

   setup<CftConsensus>(nodes, {"a", "b", "c"});

   timer_type    timer(ctx);
   global_random rng;
   loop(timer, 10s,
        [&]()
        {
           nodes.randomize(rng);
           PSIBASE_LOG(logger, info) << "connected nodes:" << nodes;
        });
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
