#include <psibase/cft.hpp>
#include <psibase/node.hpp>
#include <psibase/direct_routing.hpp>
#include <psibase/mock_timer.hpp>
#include <psibase/ForkDb.hpp>

#include <boost/asio/steady_timer.hpp>
#include <boost/asio/io_context.hpp>

#include "mapdb.hpp"

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;

template<typename Derived>
struct null_link {};

//using timer_type = mock_timer;
using timer_type = boost::asio::steady_timer;

template<typename Derived>
using cft_consensus = basic_cft_consensus<Derived, timer_type>;

template<typename Timer, typename F>
void loop(Timer& timer, F&& f)
{
   using namespace std::literals::chrono_literals;
   timer.expires_after(10s);
   timer.async_wait([&timer, f](const std::error_code& e){
      if(!e)
      {
         f();
         loop(timer, f);
      }
   });
}

TEST_CASE("")
{
   using chain_type = ForkDb;
   using node_type = node<null_link, direct_routing, cft_consensus, chain_type>;
   boost::asio::io_context ctx;
   node_type a(ctx), b(ctx), c(ctx);
   a.set_producer_id(psibase::AccountNumber{"a"});
   b.set_producer_id(psibase::AccountNumber{"b"});
   c.set_producer_id(psibase::AccountNumber{"c"});
   std::vector producers{a.producer_name(), b.producer_name(), c.producer_name()};
   a.set_producers(producers);
   b.set_producers(producers);
   c.set_producers(producers);
   auto a_addr = a.listen({boost::asio::ip::tcp::v4(), 0});
   auto b_addr = b.listen({boost::asio::ip::tcp::v4(), 0});
   auto c_addr = c.listen({boost::asio::ip::tcp::v4(), 0});
   a.async_connect(b_addr);
   a.async_connect(c_addr);
   b.async_connect(c_addr);
   int active_set = 7;
   timer_type timer(ctx);
   auto adjust_node = [&](node_type* n, bool old_state, bool new_state)
   {
      if(old_state && !new_state)
      {
         std::cout << "stop node " << n->producer_name().str() << std::endl;
         n->disconnect_all();
      }
      else if(!old_state && new_state)
      {
         std::cout << "start node " << n->producer_name().str() << std::endl;
      }
   };
   auto adjust_connection = [&](node_type* n1, auto addr, bool old_state, bool new_state)
   {
      if(!old_state && new_state)
      {
         n1->async_connect(addr);
      }
   };
   std::random_device rng;
   loop(timer, [&](){
      std::uniform_int_distribution<> dist(0, 7);
      auto next_set = dist(rng);
      adjust_node(&a, active_set & 1, next_set & 1);
      adjust_node(&b, active_set & 2, next_set & 2);
      adjust_node(&c, active_set & 4, next_set & 4);
      std::cout << "active nodes:";
      for(int i = 0; i < 3; ++i)
      {
         if(next_set & (1 << i))
         {
            std::cout << " " << (i + 1);
         }
      }
      std::cout << std::endl;
      adjust_connection(&a, b_addr, (active_set & 3) == 3, (next_set & 3) == 3);
      adjust_connection(&a, c_addr, (active_set & 5) == 5, (next_set & 5) == 5);
      adjust_connection(&b, c_addr, (active_set & 6) == 6, (next_set & 6) == 6);
      active_set = next_set;
   });
   // This should result in a steady stream of empty blocks
   ctx.run();
}
