#include <psibase/fail_stop.hpp>
#include <psibase/node.hpp>
#include <psibase/direct_routing.hpp>
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

//using timer_type = mock_timer;
using timer_type = boost::asio::steady_timer;

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
   using node_type = node<null_link, direct_routing, fail_stop_consensus, chain_type>;
   boost::asio::io_context ctx;
   node_type a(ctx), b(ctx), c(ctx);
   a.set_producer_id(1);
   b.set_producer_id(2);
   c.set_producer_id(3);
   a.set_producers({1, 2, 3});
   b.set_producers({1, 2, 3});
   c.set_producers({1, 2, 3});
   auto a_addr = a.listen({boost::asio::ip::tcp::v4(), 0});
   auto b_addr = b.listen({boost::asio::ip::tcp::v4(), 0});
   auto c_addr = c.listen({boost::asio::ip::tcp::v4(), 0});
   a.async_connect(b_addr);
   a.async_connect(c_addr);
   b.async_connect(c_addr);
   // This should result in a steady stream of empty blocks
   ctx.run();
}
