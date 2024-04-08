#include <psibase/bft.hpp>
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

using node_type = node<null_link, mock_routing, any_consensus, ForkDb>;

namespace psibase
{
   std::ostream& operator<<(std::ostream& os, const CftConsensus& consensus)
   {
      os << "CFT:";
      for (const auto& [name, auth] : consensus.producers)
      {
         os << " " << name.str();
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const BftConsensus& consensus)
   {
      os << "BFT:";
      for (const auto& [name, auth] : consensus.producers)
      {
         os << " " << name.str();
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const Consensus& consensus)
   {
      std::visit([&os](const auto& obj) { os << obj; }, consensus);
      return os;
   }
}  // namespace psibase

std::vector<std::pair<Consensus, Consensus>> transitions = {
    {cft("a"), cft("b")},
    {cft("a"), cft("a", "b", "c")},
    {cft("a"), cft("b", "c", "d")},
    {cft("a"), bft("b")},
    {cft("a"), bft("a")},
    {cft("a"), bft("a", "b", "c", "d")},
    {cft("a"), bft("b", "c", "d", "e")},
    {cft("a", "b", "c"), cft("a")},
    {cft("a", "b", "c"), cft("d")},
    {cft("a", "b", "c"), cft("a", "b", "d")},
    {cft("a", "b", "c"), cft("a", "d", "e")},
    {cft("a", "b", "c"), cft("d", "e", "f")},
    {cft("a", "b", "c"), cft("a", "b", "c", "d", "e")},
    {cft("a", "b", "c"), cft("a", "b", "d", "e", "f")},
    {cft("a", "b", "c"), cft("a", "d", "e", "f", "g")},
    {cft("a", "b", "c"), cft("d", "e", "f", "g", "h")},
    {cft("a", "b", "c"), bft("a")},
    {cft("a", "b", "c"), bft("d")},
    {cft("a", "b", "c"), bft("a", "b", "c", "d")},
    {cft("a", "b", "c"), bft("a", "b", "d", "e")},
    {cft("a", "b", "c"), bft("a", "d", "e", "f")},
    {cft("a", "b", "c"), bft("d", "e", "f", "g")},
    {cft("a", "b", "c", "d", "e"), cft("a", "b", "c")},
    {cft("a", "b", "c", "d", "e"), cft("a", "b", "f")},
    {cft("a", "b", "c", "d", "e"), cft("a", "f", "g")},
    {cft("a", "b", "c", "d", "e"), cft("f", "g", "h")},
    {cft("a", "b", "c", "d", "e"), bft("a", "b", "c", "d")},
    {cft("a", "b", "c", "d", "e"), bft("a", "b", "c", "f")},
    {cft("a", "b", "c", "d", "e"), bft("a", "b", "f", "g")},
    {cft("a", "b", "c", "d", "e"), bft("a", "f", "g", "h")},
    {cft("a", "b", "c", "d", "e"), bft("f", "g", "h", "i")},
    {cft("a", "b", "c", "d", "e", "f", "g"), bft("a", "b", "c", "d", "e", "f", "g")},
    {bft("a"), cft("a")},
    {bft("a"), cft("b")},
    {bft("a"), cft("a", "b", "c")},
    {bft("a"), cft("b", "c", "d")},
    {bft("a"), bft("b")},
    {bft("a"), bft("a", "b", "c", "d")},
    {bft("a"), bft("b", "c", "d", "e")},
    {bft("a", "b", "c", "d"), cft("a")},
    {bft("a", "b", "c", "d"), cft("b")},
    {bft("a", "b", "c", "d"), cft("a", "b", "c")},
    {bft("a", "b", "c", "d"), cft("a", "b", "e")},
    {bft("a", "b", "c", "d"), cft("a", "e", "f")},
    {bft("a", "b", "c", "d"), cft("e", "f", "g")},
    {bft("a", "b", "c", "d"), cft("a", "b", "c", "d", "e")},
    {bft("a", "b", "c", "d"), cft("a", "b", "c", "e", "f")},
    {bft("a", "b", "c", "d"), cft("a", "b", "e", "f", "g")},
    {bft("a", "b", "c", "d"), cft("a", "e", "f", "g", "h")},
    {bft("a", "b", "c", "d"), cft("e", "f", "g", "h", "i")},
    {bft("a", "b", "c", "d"), bft("a")},
    {bft("a", "b", "c", "d"), bft("e")},
    {bft("a", "b", "c", "d"), bft("a", "b", "c", "e")},
    {bft("a", "b", "c", "d"), bft("a", "b", "e", "f")},
    {bft("a", "b", "c", "d"), bft("a", "e", "f", "g")},
    {bft("a", "b", "c", "d"), bft("e", "f", "g", "h")},
    {bft("a", "b", "c", "d"), bft("a", "b", "c", "d", "e", "f", "g")},
    {bft("a", "b", "c", "d"), bft("a", "b", "c", "e", "f", "g", "h")},
    {bft("a", "b", "c", "d"), bft("a", "b", "e", "f", "g", "h", "i")},
    {bft("a", "b", "c", "d"), bft("a", "e", "f", "g", "h", "i", "j")},
    {bft("a", "b", "c", "d"), bft("e", "f", "g", "h", "i", "j", "k")},
    {bft("a", "b", "c", "d", "e", "f", "g"), cft("a", "b", "c", "d", "e", "f", "g")},
    {bft("a", "b", "c", "d", "e", "f", "g"), bft("a", "b", "c", "d")},
    {bft("a", "b", "c", "d", "e", "f", "g"), bft("a", "b", "c", "h")},
    {bft("a", "b", "c", "d", "e", "f", "g"), bft("a", "b", "h", "i")},
    {bft("a", "b", "c", "d", "e", "f", "g"), bft("a", "h", "i", "j")},
    {bft("a", "b", "c", "d", "e", "f", "g"), bft("h", "i", "j", "k")},
};

template <typename N>
void add_producers(NodeSet<N>& nodes, const Consensus& consensus)
{
   std::visit(
       [&nodes](auto& consensus)
       {
          for (Producer prod : consensus.producers)
          {
             if (std::find_if(nodes.nodes.begin(), nodes.nodes.end(),
                              [prod](const auto& n) {
                                 return n->node.producer_name() == prod.name;
                              }) == nodes.nodes.end())
                nodes.add(prod.name);
          }
       },
       consensus);
}

TEST_CASE("joint consensus", "[combined]")
{
   TEST_START(logger);

   auto dataIndex = GENERATE_INDEX(transitions);
   INFO("data-index: " << dataIndex);
   auto [start, change] = transitions.at(dataIndex);
   INFO("initial consensus: " << start);
   INFO("changed consensus: " << change);
   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   add_producers(nodes, start);
   nodes.connect_all();
   boot(nodes.getBlockContext(), start);
   runFor(ctx, 15s);

   add_producers(nodes, change);
   setProducers(nodes.getBlockContext(), change);
   nodes.connect_all();
   runFor(ctx, 15s);

   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum >= final_state->info.header.blockNum - 2);
   CHECK(!final_state->nextProducers);
   CHECK(*final_state->producers == ProducerSet(change));
}

TEST_CASE("joint consensus crash", "[combined]")
{
   TEST_START(logger);

   auto dataIndex = GENERATE_INDEX(transitions);
   INFO("data-index: " << dataIndex);
   auto [start, change] = transitions.at(dataIndex);
   INFO("initial consensus: " << start);
   INFO("changed consensus: " << change);
   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   add_producers(nodes, start);
   nodes.connect_all();
   boot(nodes.getBlockContext(), start);
   runFor(ctx, 15s);

   timer_type    timer(ctx);
   global_random rng;
   setProducers(nodes.getBlockContext(), change);
   add_producers(nodes, change);
   nodes.partition(NetworkPartition::subset(rng));
   loop(timer, 10s, [&]() { nodes.partition(NetworkPartition::subset(rng)); });

   runFor(ctx, 2min);
   timer.cancel();
   ctx.poll();
   ctx.reset();

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
   CHECK(!final_state->nextProducers);
   // Whether the change actually happens depends on how the network is partitioned
   // TODO: Once we have better transaction handling, the change should always
   // take effect.
   CHECK_THAT((std::vector{ProducerSet(start), ProducerSet(change)}),
              Catch::Matchers::VectorContains(*final_state->producers));
}

TEST_CASE("fork at commit consensus change", "[combined]")
{
   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   auto                    producers = makeAccounts({"a", "b", "c", "d"});
   nodes.add(makeAccounts({"a", "h"}));
   nodes.partition(NetworkPartition::all());
   boot<BftConsensus>(nodes.getBlockContext(), producers);
   runFor(ctx, 1s);

   auto send = [&](auto&& message)
   {
      nodes[1].sendto(AccountNumber{"a"}, message);
      ctx.poll();
      ctx.reset();
   };
   auto boot_block = nodes[0].chain().get_head_state()->info;

   auto transition = makeBlock(boot_block, "d", 2, setProducers(cft("e", "f", "g")));
   auto block1     = makeBlock(transition, "b", 4);
   auto block2 =
       makeBlock(transition, "c", 5, makeBlockConfirm(transition, {"b", "c", "d"}, {"e", "f"}));
   auto block3 = makeBlock(block2, "e", 6, block2);
   send(transition);
   send(block1);

   send(makePrepare(block1, "b"));
   send(makePrepare(block1, "c"));
   send(makePrepare(block1, "d"));

   send(block2);
   send(block3);
   CHECK(nodes[0].chain().get_head_state()->blockId() == BlockInfo{block3.block->block()}.blockId);
}
