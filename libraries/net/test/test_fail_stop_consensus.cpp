#include <psibase/fail_stop.hpp>
#include <psibase/node.hpp>
#include <psibase/mock_routing.hpp>
#include <psibase/mock_timer.hpp>
#include <psibase/fork_database.hpp>

#include <boost/asio/steady_timer.hpp>
#include <boost/asio/io_context.hpp>

#include <map>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;

template<typename Derived>
struct null_link {};

struct prefix_compare
{
   template<typename T0, typename T1, std::size_t... I>
   bool compare(const T0& lhs, const T1& rhs, std::index_sequence<I...>) const
   {
      return std::tie(std::get<I>(lhs)...) < std::tie(std::get<I>(rhs)...);
   }
   using is_transparent = void;
   template<typename... T, typename... U>
   bool operator()(const std::tuple<T...>& lhs, const std::tuple<U...>& rhs) const
   {
      return compare(lhs, rhs, std::make_index_sequence<std::min(sizeof...(T), sizeof...(U))>{});
   }
   template<typename... T, typename U>
   bool operator()(const std::tuple<T...>& lhs, const U& rhs) const
   {
      return std::get<0>(lhs) < rhs;
   };
   template<typename T, typename... U>
   bool operator()(const T& lhs, const std::tuple<U...>& rhs) const
   {
      return lhs < std::get<0>(rhs);
   }
   template<typename T, typename U>
   bool operator()(const T& lhs, const U& rhs) const
   {
      return lhs < rhs;
   }
};

struct mapdb
{
   template<typename K, typename V>
   using index = std::map<K, V, prefix_compare>;
};

using timer_type = mock_timer;
//using timer_type = boost::asio::steady_timer;

template<typename Derived>
using fail_stop_consensus = basic_fail_stop_consensus<Derived, timer_type>;

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
   using chain_type = fork_database<block_header<timer_type::time_point>, block_header_state<timer_type::time_point>, mapdb>;
   using node_type = node<null_link, mock_routing, fail_stop_consensus, chain_type>;
   boost::asio::io_context ctx;
   mock_network<node_type> network(ctx);
   node_type a(ctx), b(ctx), c(ctx);
   network.add(&a);
   network.add(&b);
   network.add(&c);
   a.set_producer_id(1);
   b.set_producer_id(2);
   c.set_producer_id(3);
   a.set_producers({1, 2, 3});
   b.set_producers({1, 2, 3});
   c.set_producers({1, 2, 3});
   a.add_peer(&b);
   a.add_peer(&c);
   b.add_peer(&c);
   int active_set = 7;
   timer_type timer(ctx);
   auto adjust_node = [&](node_type* n, bool old_state, bool new_state)
   {
      if(old_state && !new_state)
      {
         std::cout << "stop node " << n->producer_name() << std::endl;
         network.remove(n);
      }
      else if(!old_state && new_state)
      {
         std::cout << "start node " << n->producer_name() << std::endl;
         network.add(n);
      }
   };
   auto adjust_connection = [&](node_type* n1, node_type* n2, bool old_state, bool new_state)
   {
      if(old_state && !new_state)
      {
         n1->remove_peer(n2);
      }
      else if(!old_state && new_state)
      {
         n1->add_peer(n2);
      }
   };
   std::random_device rng;
   loop(timer, [&](){
      std::uniform_int_distribution<> dist(0, 7);
      auto next_set = dist(rng);
      //adjust_node(&a, active_set & 1, next_set & 1);
      //adjust_node(&b, active_set & 2, next_set & 2);
      //adjust_node(&c, active_set & 4, next_set & 4);
      std::cout << "active nodes:";
      for(int i = 0; i < 3; ++i)
      {
         if(next_set & (1 << i))
         {
            std::cout << " " << (i + 1);
         }
      }
      std::cout << std::endl;
      adjust_connection(&a, &b, (active_set & 3) == 3, (next_set & 3) == 3);
      adjust_connection(&a, &c, (active_set & 5) == 5, (next_set & 5) == 5);
      adjust_connection(&b, &c, (active_set & 6) == 6, (next_set & 6) == 6);
      active_set = next_set;
   });
   // This should result in a steady stream of empty blocks
   while(true)
   {
      ctx.run();
      ctx.restart();
      using namespace std::literals::chrono_literals;
      mock_clock::advance(100ms);
   }
}
