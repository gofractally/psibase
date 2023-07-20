#include <psibase/shortest_path_routing.hpp>

#include <psibase/node.hpp>
#include <psibase/peer_manager.hpp>
#include "connection_pair.hpp"

#define CATCH_CONFIG_RUNNER
#include <catch2/catch.hpp>

using namespace psibase;
using namespace psibase::net;

TEST_CASE("seqno")
{
   CHECK(SequenceNumber{0} < SequenceNumber{1});
   CHECK(SequenceNumber{0} < SequenceNumber{32767});
   CHECK(!(SequenceNumber{0} < SequenceNumber{32768}));
   CHECK(!(SequenceNumber{32768} < SequenceNumber{0}));
}

TEST_CASE("feasibility")
{
   CHECK((Feasibility{SequenceNumber{0}, RouteMetric{2}} <
          Feasibility{SequenceNumber{0}, RouteMetric{3}}));
   CHECK((Feasibility{SequenceNumber{1}, RouteMetric{2}} <
          Feasibility{SequenceNumber{0}, RouteMetric{1}}));
}

struct message1
{
   static constexpr unsigned type = 96;
   std::int32_t              value;
   std::string               to_string() const { return std::to_string(value); }
   friend auto               operator<=>(const message1&, const message1&) = default;
};
PSIO_REFLECT(message1, value)

std::ostream& operator<<(std::ostream& os, const message1& msg)
{
   return os << msg.value;
}

template <typename Derived>
struct mock_consensus
{
   explicit mock_consensus(boost::asio::io_context&) {}
   using message_type = std::variant<message1>;
   AccountNumber producer_name() const { return producer; }
   void          set_producer_id(AccountNumber account) { producer = account; }

   void connect(peer_id id) {}
   void disconnect(peer_id id) {}
   void recv(peer_id id, message1 msg) { _recv_queue.push_back(msg); }
   void expect(std::vector<message1> messages)
   {
      CHECK(_recv_queue == messages);
      _recv_queue.clear();
   }
   std::vector<message1> consume()
   {
      auto result = std::move(_recv_queue);
      _recv_queue.clear();
      return result;
   }
   std::vector<message1> _recv_queue;
   AccountNumber         producer;
   std::string           name = "<anonymous node>";
};

using node_type = node<peer_manager, shortest_path_routing, mock_consensus, int>;

void connect(boost::asio::io_context& ctx, node_type& node1, node_type& node2)
{
   auto [p1, p2] = make_connection_pair(ctx);
   p1->logger.add_attribute("Host", boost::log::attributes::constant(node1.name));
   p2->logger.add_attribute("Host", boost::log::attributes::constant(node2.name));
   p1->logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant(node2.name));
   p2->logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant(node1.name));
   p1->url = node2.name;
   p2->url = node1.name;

   node1.peers().connect(node2.name,
                         [&node1, p1 = std::move(p1)](const std::string&, auto&& next) mutable
                         {
                            node1.peers().add_connection(std::move(p1));
                            next(std::error_code());
                         });
   node2.peers().connect(node1.name,
                         [&node2, p2 = std::move(p2)](const std::string&, auto&& next) mutable
                         {
                            node2.peers().add_connection(std::move(p2));
                            next(std::error_code());
                         });
}

struct TestNode : node_type
{
   TestNode(boost::asio::io_context& ctx, const std::string& name) : node_type(ctx), ctx(ctx)
   {
      this->name = name;
   }
   ~TestNode() { disconnect_all(false); }
   boost::asio::io_context& ctx;
};

void connect(TestNode& node1, TestNode& node2)
{
   connect(node1.ctx, node1, node2);
}

void disconnect(TestNode& node1, TestNode& node2)
{
   for (const auto& [id, ptr] : node1.connections())
   {
      if (ptr->url && *ptr->url == node2.name)
      {
         node1.peers().disconnect(id);
         break;
      }
   }
}

TEST_CASE("basic routing")
{
   boost::asio::io_context ctx;
   TestNode                node1(ctx, "a"), node2(ctx, "b"), node3(ctx, "c");
   node3.set_producer_id(AccountNumber{"c"});
   connect(node1, node2);
   connect(node2, node3);
   ctx.run();
   ctx.restart();
   // a message sent by node1 to node3 will reach node3
   node1.network().sendto(AccountNumber{"c"}, message1{42});
   ctx.run();
   node3.consensus().expect({message1{42}});
}

TEST_CASE("cycle")
{
   boost::asio::io_context ctx;
   TestNode                node1(ctx, "a"), node2(ctx, "b"), node3(ctx, "c");
   node3.set_producer_id(AccountNumber{"c"});
   connect(node1, node2);
   connect(node2, node3);
   connect(node1, node3);
   ctx.run();
   ctx.restart();
   // a message sent by node1 to node3 will reach node3
   node1.network().sendto(AccountNumber{"c"}, message1{42});
   ctx.run();
   ctx.restart();
   CHECK(node3.consume() == std::vector{message1{42}});

   disconnect(node1, node3);
   ctx.run();
   ctx.restart();

   node1.network().sendto(AccountNumber{"c"}, message1{7});
   ctx.run();
   ctx.restart();
   CHECK(node3.consume() == std::vector{message1{7}});
}

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format = "[{Severity}] [{Host}]{?:-[{RemoteEndpoint}]}: {Message}";
};
PSIO_REFLECT(ConsoleLog, type, filter, format);

struct Loggers
{
   ConsoleLog stderr;
};
PSIO_REFLECT(Loggers, stderr);

int main(int argc, const char* const* argv)
{
   Loggers logConfig;

   Catch::Session session;

   using Catch::clara::Opt;
   auto cli = session.cli() | Opt(logConfig.stderr.filter,
                                  "filter")["--log-filter"]("The filter to apply to node loggers");
   session.cli(cli);

   if (int res = session.applyCommandLine(argc, argv))
      return res;

   loggers::configure(psio::convert_from_json<loggers::Config>(psio::convert_to_json(logConfig)));
   return session.run();
}
