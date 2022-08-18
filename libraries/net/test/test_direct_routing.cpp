#include <psibase/direct_routing.hpp>
#include <psibase/node.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace psibase::net;

template <typename Derived>
struct mock_consensus
{
   explicit mock_consensus(boost::asio::io_context&) {}
   struct message1
   {
      std::int32_t value;
      std::string  to_string() const { return std::to_string(value); }
      PSIO_REFLECT(message1, value)
      friend reflect_impl_message1 get_reflect_impl(const message1&) { return {}; }
   };
   using message_type = std::variant<message1>;
   void connect(peer_id id)
   {
      // FIXME: somehow associate peer_ids with specific nodes
      CHECK(id == 0);
      static_cast<Derived*>(this)->network().async_send_block(id, message1{42},
                                                              [](const std::error_code&) {});
   }
   void recv(peer_id id, message1 msg)
   {
      _recv_queue.push({id, msg});
      check_queue();
   }
   void expect(peer_id id, message1 msg)
   {
      _expect_queue.push({id, msg});
      check_queue();
   }
   void check_queue()
   {
      if (!_recv_queue.empty && !_expect_queue.empty())
      {
         auto& received = _recv_queue.front();
         auto& expected = _expect_queue.front();
         CHECK(received.first == expected.first);
         CHECK(received.second.value == expected.second.value);
         _recv_queue.pop();
         _expect_queue.pop();
      }
   }
   std::queue<std::pair<peer_id, message1>> _expect_queue, _recv_queue;
};

template <typename Derived>
struct null_link
{
};

TEST_CASE("")
{
   using chain_type = int;
   using node_type  = node<null_link, direct_routing, mock_consensus, chain_type>;
   boost::asio::io_context ctx;
   node_type               node1(ctx);
   node_type               node2(ctx);

   auto endpoint = node1.listen({boost::asio::ip::tcp::v4(), 0});
   node2.async_connect(endpoint);

   ctx.run();
}
