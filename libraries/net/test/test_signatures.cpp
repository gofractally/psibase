#include <psibase/EcdsaProver.hpp>

#include <catch2/catch.hpp>

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
   auto ecc    = std::make_shared<EcdsaSecp256K1Sha256Prover>(AccountNumber{"verifyec-sys"});
   auto prover = std::make_shared<CompoundProver>();
   prover->add(ecc);
   nodes.add(AccountNumber{"prod"}, prover);
   nodes.add(AccountNumber{"client"});
   boot(nodes.getBlockContext(), Consensus{CftConsensus{{Producer{prod, ecc->get()}}}}, true);
   runFor(ctx, 5s);
   nodes.connect_all();
   runFor(ctx, 1s);

   // The nodes should have the same head
   auto final_state = nodes[0].chain().get_head_state();
   for (const auto& node : nodes.nodes)
      CHECK(final_state->blockId() == node->chain().get_head_state()->blockId());
   CHECK(final_state->blockNum() >= 3);
}
