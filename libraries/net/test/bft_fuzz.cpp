#include "test_util.hpp"

#include <triedent/database.hpp>

#include <boost/log/attributes/function.hpp>

// the central node can take the following actions:
// - single step another node's io_context
// - advance a node's clock
// - send a message to another node
// - create a block that builds on any existing block
// - prepare any existing block
// - commit any existing block
// - generate a view change

// Alternate implementation of mock_timer
namespace psibase::test
{
   namespace
   {
      mock_clock::time_point                         mock_current_time;
      std::vector<std::shared_ptr<mock_timer::impl>> timer_queue;
      std::mutex                                     queue_mutex;
      void cancel_timer(const std::shared_ptr<mock_timer::impl>& impl)
      {
         auto pos = std::find(timer_queue.begin(), timer_queue.end(), impl);
         if (pos != timer_queue.end())
         {
            swap(*pos, timer_queue.back());
            timer_queue.pop_back();
            for (const auto& f : impl->callbacks)
            {
               f(make_error_code(boost::asio::error::operation_aborted));
            }
            impl->callbacks.clear();
         }
      }
      void expire_one_timer(auto& rng)
      {
         if (!timer_queue.empty())
         {
            auto              idx  = rng() % timer_queue.size();
            mock_timer::impl* head = timer_queue.front().get();
            {
               mock_current_time = std::max(mock_current_time, head->deadline);
               for (const auto& f : head->callbacks)
               {
                  f(std::error_code{});
               }
               head->callbacks.clear();
            }
            std::swap(timer_queue[idx], timer_queue.back());
            timer_queue.pop_back();
         }
      }
   }  // namespace

   mock_clock::time_point mock_clock::now()
   {
      std::lock_guard l{queue_mutex};
      return mock_current_time;
   }

   void mock_clock::advance()
   {
      assert(!"not implemented");
   }

   void mock_clock::reset()
   {
      std::lock_guard l{queue_mutex};
      mock_current_time = {};
      timer_queue.clear();
   }
   std::ostream& operator<<(std::ostream& os, mock_clock::time_point tp)
   {
      os << tp.time_since_epoch().count();
      return os;
   }

   mock_timer::~mock_timer()
   {
      cancel();
   }
   void mock_timer::expires_at(time_point expiration)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = expiration;
   }
   void mock_timer::expires_after(duration d)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = mock_current_time + d;
   }
   void mock_timer::async_wait(std::function<void(const std::error_code&)> callback)
   {
      std::lock_guard l{queue_mutex};
      _impl->callbacks.push_back(_impl->bind(std::move(callback)));
      if (_impl->callbacks.size() == 1)
      {
         timer_queue.push_back(_impl);
      }
   }
   void mock_timer::cancel()
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
   }

   global_random::result_type global_random::operator()()
   {
      return 0;
   }
}  // namespace psibase::test

using namespace psibase;
using namespace psibase::net;
using namespace psio;
using namespace psibase::test;

struct Network;

template <typename Derived>
struct fuzz_routing : message_serializer<Derived>
{
   explicit fuzz_routing(boost::asio::io_context& ctx) : ctx(ctx)
   {
      logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
   }
   void send(const auto& message)
   {
      PSIBASE_LOG(logger, debug) << "Send message: " << message.to_string() << std::endl;
      [&message](auto* n) { n->recv(message); }(_network);
   }
   template <typename Msg, typename F>
   void async_send_block(peer_id id, const Msg& msg, F&& f)
   {
      if (peer != id)
      {
         throw std::runtime_error("unknown peer");
      }
      send(msg);
      ctx.post([f]() { f(std::error_code()); });
   }
   template <typename Msg>
   void multicast_producers(const Msg& msg)
   {
      send(msg);
   }
   template <typename Msg>
   void sendto(producer_id producer, const Msg& msg)
   {
      send(msg);
   }
   // make a copy of the argument in case it gets invalidated by
   // vector reallocation.
   void recv(auto message)
   {
      PSIBASE_LOG(logger, debug) << "Receive message: " << message.to_string() << std::endl;
      try
      {
         static_cast<Derived*>(this)->consensus().recv(peer, message);
      }
      catch (std::exception& e)
      {
         PSIBASE_LOG(logger, warning) << e.what();
      }
   }
   void recv(const shared_view_ptr<SignedBlock>& message) { recv(BlockMessage{message}); }
   void init(Network* network)
   {
      _network = network;
      static_cast<Derived*>(this)->consensus().connect(peer);
   }
   boost::asio::io_context& ctx;
   static constexpr peer_id peer     = 0;
   Network*                 _network = nullptr;
   loggers::common_logger   logger;
};

using node_type = node<null_link, fuzz_routing, bft_consensus, ForkDb>;

struct end_of_test
{
};

struct FuzzNode
{
   explicit FuzzNode(Network* network, SystemContext* sysContext, AccountNumber name)
       : node(ctx, sysContext)
   {
      auto attr = boost::log::attributes::constant(name.str());
      node.chain().getBlockLogger().add_attribute("Host", attr);
      node.chain().getLogger().add_attribute("Host", attr);
      node.consensus().logger.add_attribute("Host", attr);
      node.network().logger.add_attribute("Host", attr);
      node.network()._network = network;
      node.set_producer_id(name);
      node.load_producers();
      node.network().init(network);
      ctx.post(
          [this]()
          {
             node.network().recv(HelloRequest{});
             node.network().recv(HelloResponse{});
          });
      ctx.poll();
   }
   boost::asio::io_context ctx;
   node_type               node;
   auto                    poll_one() { return ctx.poll_one(); }
};

struct Network
{
   explicit Network(SystemContext* ctx) : systemContext(ctx) {}
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
            psibase::test::expire_one_timer(rng);
            break;
         }
      }
   }

   void forward_message(auto& rng, const auto& node)
   {
      switch (rng() % 4)
      {
         case 0:
            forward_message(rng, node, blocks);
            break;
         case 1:
            forward_message(rng, node, prepares);
            break;
         case 2:
            forward_message(rng, node, commits);
            break;
         case 3:
            forward_message(rng, node, view_changes);
            break;
      }
   }

   void forward_message(auto& rng, const auto& node, const auto& messages)
   {
      if (!messages.empty())
         node->node.network().recv(messages[messages.size() - rng() % messages.size() - 1]);
   }

   std::size_t choose_block(auto& rng)
   {
      if (blocks.empty())
         return 0;
      // Building blocks is relatively expensive.  256 blocks
      // should be enough to generate any interesting chain topology
      if (blocks.size() > 255)
         throw end_of_test();
      return blocks.size() - rng() % blocks.size() - 1;
   }

   void add_prepare(std::size_t idx)
   {
      if (blocks.empty())
         return;
      if (prepared_blocks.size() < idx + 1)
      {
         prepared_blocks.resize(idx + 1);
      }
      if (!prepared_blocks[idx])
      {
         BlockInfo info(blocks[idx]->block());
         prepared_blocks[idx] = true;
         prepares.push_back(SignedMessage<PrepareMessage>{PrepareMessage{info.blockId, producer}});
      }
   }

   void add_commit(std::size_t idx)
   {
      if (blocks.empty())
         return;
      if (commited_blocks.size() < idx + 1)
      {
         commited_blocks.resize(idx + 1);
      }
      if (!commited_blocks[idx])
      {
         BlockInfo info(blocks[idx]->block());
         commited_blocks[idx] = true;
         commits.push_back(SignedMessage<CommitMessage>{CommitMessage{info.blockId, producer}});
      }
   }

   void add_view_change(auto& rng)
   {
      // TODO: make view random
      view_changes.push_back(ViewChangeMessage{++view, producer});
   }

   void build_block(std::size_t idx)
   {
      if (blocks.empty())
         return;
      auto        block = blocks[idx];
      BlockInfo   info{block->block()};
      SignedBlock newBlock;
      newBlock.block.header.previous = info.blockId;
      newBlock.block.header.blockNum = info.header.blockNum + 1;
      newBlock.block.header.time.seconds =
          std::chrono::duration_cast<std::chrono::seconds>(mock_clock::now().time_since_epoch())
              .count();
      newBlock.block.header.producer  = producer;
      newBlock.block.header.term      = view;
      newBlock.block.header.commitNum = info.header.commitNum;
      recv(BlockMessage{newBlock});
   }

   void recv(const BlockMessage& message)
   {
      BlockInfo info(message.block->block());
      if (blockIds.insert(info.blockId).second)
      {
         blocks.push_back(message.block);
      }
   }

   void recv(const SignedMessage<PrepareMessage>& message)
   {
      if (!has_message(message, prepares))
         prepares.push_back(message);
   }

   void recv(const SignedMessage<CommitMessage>& message)
   {
      if (!has_message(message, commits))
         commits.push_back(message);
   }

   void recv(const ViewChangeMessage& message)
   {
      if (!has_message(message, view_changes))
         view_changes.push_back(message);
   }

   void recv(const HelloRequest&) {}
   void recv(const HelloResponse&) {}

   template <typename T>
   static bool has_message(const SignedMessage<T>&              message,
                           const std::vector<SignedMessage<T>>& vec)
   {
      for (const auto& m : vec)
      {
         if (message.data.size() == m.data.size() &&
             std::memcmp(m.data.data(), message.data.data(), m.data.size()) == 0)
            return true;
      }
      return false;
   }
   static bool has_message(const ViewChangeMessage&              message,
                           const std::vector<ViewChangeMessage>& vec)
   {
      return std::find(vec.begin(), vec.end(), message) != vec.end();
   }

   void add_node(std::string_view name)
   {
      nodes.push_back(std::make_unique<FuzzNode>(this, systemContext, AccountNumber(name)));
   }

   std::vector<shared_view_ptr<SignedBlock>>  blocks;
   std::set<Checksum256>                      blockIds;
   std::vector<SignedMessage<PrepareMessage>> prepares;
   std::vector<SignedMessage<CommitMessage>>  commits;
   std::vector<bool>                          prepared_blocks;
   std::vector<bool>                          commited_blocks;
   std::vector<ViewChangeMessage>             view_changes;
   std::vector<std::unique_ptr<FuzzNode>>     nodes;
   AccountNumber                              producer{"mallory"};
   TermNum                                    view = 0;
   SystemContext*                             systemContext;
};

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format =
       "[{TimeStamp}] [{Severity}] [{Host}]: {Message}{?: {BlockId}: {BlockHeader}}";
};
PSIO_REFLECT(ConsoleLog, type, filter, format);

struct Loggers
{
   ConsoleLog stderr;
};
PSIO_REFLECT(Loggers, stderr);

void init_logging(const Loggers& logConfig)
{
   loggers::configure(psio::convert_from_json<loggers::Config>(psio::convert_to_json(logConfig)));

   // Replace timestamp with mock clock
   {
      auto core = boost::log::core::get();
      auto attr = boost::log::attributes::function<std::chrono::system_clock::time_point>(
          []()
          {
             return std::chrono::system_clock::time_point{
                 psibase::test::mock_clock::now().time_since_epoch()};
          });
      auto [iter, inserted] = core->add_global_attribute("TimeStamp", attr);
      if (!inserted)
      {
         core->remove_global_attribute(iter);
         core->add_global_attribute("TimeStamp", attr);
      }
   }
}

struct bufrng
{
   using result_type = unsigned short;
   static constexpr unsigned short min() { return 0; }
   static constexpr unsigned short max() { return 255; }
   unsigned short                  operator()()
   {
      unsigned short result;
      if (end - ptr < 1)
         throw end_of_test();
      std::memcpy(&result, ptr, 1);
      ptr += 1;
      return result;
   }
   unsigned char* ptr;
   unsigned char* end;
};

#ifndef __AFL_FUZZ_TESTCASE_LEN
#include <iostream>
namespace
{
   std::size_t fuzz_len;
#define __AFL_FUZZ_TESTCASE_LEN ::fuzz_len
   unsigned char fuzz_buf[1024000];
#define __AFL_FUZZ_TESTCASE_BUF ::fuzz_buf
#define __AFL_LOOP(x) \
   (fuzz_len = (std::cin.read((char*)::fuzz_buf, sizeof(::fuzz_buf)), std::cin.gcount()))
}  // namespace
#else
__AFL_FUZZ_INIT();
#endif

int main(int argc, const char** argv)
{
   Loggers logConfig;
   for (int i = 1; i < argc; ++i)
   {
      if (std::string_view("--log-filter") == argv[i])
      {
         ++i;
         if (i == argc)
         {
            break;
         }
         logConfig.stderr.filter = argv[i];
      }
      else if (std::string_view("--help") == argv[i] || std::string_view("-h") == argv[i])
      {
         std::cerr << "Usage: " << argv[0]
                   << " [--help] [--log-filter <filter>]\n\n"
#ifdef __AFL_COMPILER
                      "AFL++ instrumented binary\n\n"
#endif
                      "Reads random bytes from stdin to control a simulation of a\n"
                      "four producer network with one malicious producer."
                   << std::endl;
         return 2;
      }
   }
   ExecutionContext::registerHostFunctions();
   init_logging(logConfig);

   TempDatabase db;
   auto         systemContext = db.getSystemContext();
   {
      Network network(systemContext.get());
      network.add_node("alice");
      boot<BftConsensus>(network.nodes.front()->node.chain().getBlockContext(),
                         {"alice", "bob", "carol", "mallory"});
      auto zero_rng = []() { return 0; };
      // The only active timer should be the block timer
      assert(timer_queue.size() == 1);
      expire_one_timer(zero_rng);
      network.nodes[0]->ctx.poll();
   }
   auto initialHead  = systemContext->sharedDatabase.getHead();
   auto initialState = systemContext->sharedDatabase.createWriter()->get_top_root();
   auto initialClock = mock_current_time;

   unsigned char* buf = __AFL_FUZZ_TESTCASE_BUF;

   while (__AFL_LOOP(1000))
   {
      int len = __AFL_FUZZ_TESTCASE_LEN;
      {
         auto writer = systemContext->sharedDatabase.createWriter();
         systemContext->sharedDatabase.setHead(*writer, initialHead);
         writer->set_top_root(initialState);
      }
      mock_current_time = initialClock;
      timer_queue.clear();

      Network network(systemContext.get());
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
      for (const auto& node1 : network.nodes)
      {
         auto commit1 = node1->node.chain().commit_index();
         for (const auto& node2 : network.nodes)
         {
            auto commit2    = node2->node.chain().commit_index();
            auto min_commit = std::min(commit1, commit2);
            if (min_commit > 1)
            {
               assert(node1->node.chain().get_block_id(min_commit) ==
                      node1->node.chain().get_block_id(min_commit));
            }
         }
      }
   }
}
