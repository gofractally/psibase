#include <psibase/bft.hpp>
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

using node_type = node<null_link, mock_routing, any_consensus, ForkDb>;

template <typename C>
Consensus makeConsensus(std::initializer_list<AccountNumber> names)
{
   C consensus;
   for (auto account : names)
   {
      consensus.producers.push_back({AccountNumber{account}});
   }
   return consensus;
}

auto cft(auto... args)
{
   return makeConsensus<CftConsensus>({AccountNumber(args)...});
}

auto bft(auto... args)
{
   return makeConsensus<BftConsensus>({AccountNumber(args)...});
}

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

TEST_CASE("producer schedule change", "[bft][cft]")
{
   auto [start, change] = GENERATE(from_range(transitions));
   using namespace std::literals::chrono_literals;
   loggers::common_logger logger;
   logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"}));
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
