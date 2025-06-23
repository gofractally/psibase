#include <psibase/OpenSSLProver.hpp>

#include <catch2/catch_all.hpp>

#include "test_util.hpp"

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;
using namespace std::literals::chrono_literals;

using node_type = node<null_link, mock_routing, any_consensus, ForkDb>;

TEST_CASE("block signature")
{
   TEST_START(logger);

   boost::asio::io_context ctx;
   NodeSet<node_type>      nodes(ctx);
   AccountNumber           prod{"prod"};
   auto                    ecc    = std::make_shared<OpenSSLProver>(AccountNumber{"verify-sig"});
   auto                    prover = std::make_shared<CompoundProver>();
   prover->add(ecc);
   nodes.add(AccountNumber{"prod"}, prover);
   nodes.add(AccountNumber{"client"});
   boot(nodes[0], ConsensusData{CftConsensus{{Producer{prod, ecc->get()}}}}, true);
   runFor(ctx, 5s);
   nodes.connect_all();
   runFor(ctx, 1s);

   // The nodes should have the same head
   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
   CHECK(final_state->blockNum() >= 3);
}

TEST_CASE("load signature state")
{
   TEST_START(logger);

   TempDatabase  db;
   auto          system = db.getSystemContext();
   AccountNumber prod{"prod"};
   auto          prover = std::make_shared<OpenSSLProver>(AccountNumber{"verify-sig"});
   {
      boost::asio::io_context ctx;
      node_type               node{ctx, system.get(), prover};
      node.set_producer_id(prod);
      node.load_producers();
      boot(node, ConsensusData{CftConsensus{{Producer{prod, prover->get()}}}}, true);
      runFor(ctx, 5s);
   }
   {
      boost::asio::io_context ctx;
      node_type               node{ctx, system.get(), prover};
      node.set_producer_id(prod);
      node.load_producers();
      auto blocknum = node.chain().get_head_state()->blockNum();
      runFor(ctx, 5s);
      auto final_state = node.chain().get_head_state();
      // We've successfully produced at least one more block
      CHECK(final_state->blockNum() > blocknum);
   }
}
