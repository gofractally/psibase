#include "fuzz.hpp"
#include "test_util.hpp"

#include <triedent/database.hpp>

// the central node can take the following actions:
// - single step another node's io_context
// - advance a node's clock
// - send a message to another node
// - create a block that builds on any existing block
// - prepare any existing block
// - commit any existing block
// - generate a view change

using namespace psibase;
using namespace psibase::net;
using namespace psio;
using namespace psibase::test;

struct Network;

template <typename Derived>
using fuzz_routing = basic_fuzz_routing<Network, Derived>;

using node_type = node<null_link, fuzz_routing, bft_consensus, ForkDb>;

struct Network : NetworkBase<node_type>
{
   explicit Network(SystemContext* ctx) : NetworkBase(ctx) {}
   template <typename Engine>
   void do_step(Engine& rng)
   {
      switch (rng() % 32)
      {
         case 0:
         case 7:
         case 8:
         case 21:
         case 22:
         case 23:
         case 24:
         case 27:
         case 28:
         {
            nodes[rng() % nodes.size()]->poll_one();
            break;
         }
         case 1:
         case 9:
         case 10:
         case 14:
         case 15:
         case 17:
         case 18:
         case 19:
         case 20:
         case 29:
         case 30:
         case 31:
         {
            forward_message(rng, nodes[rng() % nodes.size()]);
            break;
         }
         case 2:
         {
            build_block(choose_block(rng));
            break;
         }
         case 3:
         case 11:
         {
            add_prepare(choose_block(rng));
            break;
         }
         case 4:
         case 12:
         {
            add_commit(choose_block(rng));
            break;
         }
         case 5:
         {
            add_view_change(rng);
            break;
         }
         case 6:
         case 13:
         case 25:
         case 26:
         {
            expire_one_timer(rng);
            break;
         }
      }
   }
};

__AFL_FUZZ_INIT();

int main(int argc, const char** argv)
{
   handleArgs(argc, argv);

   unsigned char* buf = __AFL_FUZZ_TESTCASE_BUF;

   while (__AFL_LOOP(1000))
   {
      int            len = __AFL_FUZZ_TESTCASE_LEN;
      StaticDatabase db{bft("alice", "bob", "carol", "mallory")};

      Network network(db);
      network.add_node("alice");
      network.add_node("bob");
      network.add_node("carol");

      try
      {
         bufrng rng{buf, buf + len};
         //std::mt19937 rng;
         while (true)
         {
            network.do_step(rng);
         }
      }
      catch (end_of_test&)
      {
      }
      // Check consistency
      network.assert_consistent_commit();
      network.deliver_all();
      network.assert_matching_head();
   }
}
