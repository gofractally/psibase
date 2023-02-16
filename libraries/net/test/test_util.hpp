#pragma once

#include <psibase/bft.hpp>
#include <psibase/blocknet.hpp>
#include <psibase/cft.hpp>
#include <psibase/node.hpp>

#include <psibase/mock_routing.hpp>
#include <psibase/mock_timer.hpp>

#include <boost/asio/io_context.hpp>

#include <filesystem>
#include <random>

#include <catch2/catch.hpp>

template <>
struct Catch::StringMaker<psibase::Checksum256>
{
   static std::string convert(const psibase::Checksum256& obj)
   {
      return psibase::loggers::to_string(obj);
   }
};

template <typename Derived>
struct null_link
{
   explicit null_link(boost::asio::io_context&) {}
};

using timer_type = psibase::test::mock_timer;

using psibase::net::basic_bft_consensus;
using psibase::net::basic_cft_consensus;
using psibase::net::BlockMessage;
using psibase::net::blocknet;
using psibase::net::CommitMessage;
using psibase::net::PrepareMessage;
using psibase::net::SignedMessage;
using psibase::net::ViewChangeMessage;

template <typename Derived>
using cft_consensus = basic_cft_consensus<blocknet<Derived, timer_type>, timer_type>;

template <typename Derived>
using bft_consensus = basic_bft_consensus<blocknet<Derived, timer_type>, timer_type>;

template <typename Derived>
using any_consensus =
    basic_bft_consensus<basic_cft_consensus<blocknet<Derived, timer_type>, timer_type>, timer_type>;

template <typename Timer, typename Duration, typename F>
void loop(Timer& timer, Duration d, F&& f)
{
   timer.expires_after(d);
   timer.async_wait(
       [&timer, d, f](const std::error_code& e)
       {
          if (!e)
          {
             f();
             loop(timer, d, f);
          }
       });
}

struct TempDir
{
   explicit TempDir(std::string_view name);
   ~TempDir();
   std::filesystem::path path;
};

struct WasmMemoryCache
{
   std::vector<std::vector<psibase::ExecutionMemory>> memories;
   void                                               init(psibase::SystemContext& ctx)
   {
      if (!memories.empty())
      {
         ctx.executionMemories = std::move(memories.back());
         memories.pop_back();
      }
   }
   void cleanup(psibase::SystemContext& ctx)
   {
      if (!ctx.executionMemories.empty())
         memories.push_back(std::move(ctx.executionMemories));
   }
   static WasmMemoryCache& instance()
   {
      static WasmMemoryCache result;
      return result;
   }
};

struct TempDatabase
{
   TempDatabase()
       : dir("psibase-test"),
         sharedState{std::make_shared<psibase::SharedState>(
             psibase::SharedDatabase{dir.path.native(), true, 1'000'000ul, 27, 27, 27, 27},
             psibase::WasmCache{16})}
   {
   }
   auto    getSystemContext() { return sharedState->getSystemContext(); }
   TempDir dir;
   std::shared_ptr<psibase::SharedState> sharedState;
};

template <typename Node>
struct TestNode
{
   TestNode(boost::asio::io_context& ctx, psibase::AccountNumber producer)
       : system(db.getSystemContext()), node(ctx, system.get())
   {
      auto attr = boost::log::attributes::constant(producer.str());
      node.chain().getBlockLogger().add_attribute("Host", attr);
      node.chain().getLogger().add_attribute("Host", attr);
      node.consensus().logger.add_attribute("Host", attr);
      node.network().logger.add_attribute("Host", attr);
      node.set_producer_id(producer);
      node.load_producers();
      WasmMemoryCache::instance().init(*system);
   }
   ~TestNode()
   {
      WasmMemoryCache::instance().cleanup(*system);
      db.sharedState->addSystemContext(std::move(system));
   }
   TempDatabase                            db;
   std::unique_ptr<psibase::SystemContext> system;
   Node                                    node;
   // accessors
   auto& chain() { return node.chain(); }
};

struct NetworkPartition
{
   NetworkPartition() = default;
   NetworkPartition(const std::vector<std::string_view>& names)
   {
      for (auto name : names)
      {
         groups.insert({psibase::AccountNumber{name}, 0});
      }
   }
   std::map<psibase::AccountNumber, std::size_t> groups;
   std::optional<std::size_t>                    operator[](psibase::AccountNumber producer) const
   {
      if (auto iter = groups.find(producer); iter != groups.end())
         return iter->second;
      return {};
   }
   // generates a single connected subset of nodes. Each producer is included
   // in the subset with probability p.
   static auto subset(std::uniform_random_bit_generator auto& rng, double p = 0.5)
   {
      return [&rng, p](const std::vector<psibase::AccountNumber>& producers)
      {
         NetworkPartition            result;
         std::bernoulli_distribution dist(p);
         for (auto producer : producers)
         {
            if (dist(rng))
               result.groups.insert({producer, 0});
         }
         return result;
      };
   }
   // Splits the producers into two disjoint connected subsets of approximately equal size.
   static auto split(std::uniform_random_bit_generator auto& rng)
   {
      return [&rng](const std::vector<psibase::AccountNumber>& prods)
      {
         NetworkPartition result;
         std::size_t      count = prods.size() / 2;
         std::size_t      n     = prods.size();
         for (const auto& prod : prods)
         {
            std::uniform_int_distribution<std::size_t> dist(0, n - 1);
            if (dist(rng) < count)
            {
               result.groups.insert({prod, 0});
               --count;
            }
            else
            {
               result.groups.insert({prod, 1});
            }
            --n;
         }
         return result;
      };
   }
   static auto all()
   {
      return [](const std::vector<psibase::AccountNumber>& prods)
      {
         NetworkPartition result;
         for (const auto& prod : prods)
         {
            result.groups.insert({prod, 0});
         }
         return result;
      };
   }
};

std::ostream& operator<<(std::ostream& os, const NetworkPartition&);

template <typename Node>
struct NodeSet
{
   explicit NodeSet(boost::asio::io_context& ctx) : ctx(ctx)
   {
      logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"}));
   }
   void add(psibase::AccountNumber producer)
   {
      nodes.push_back(std::make_unique<TestNode<Node>>(ctx, producer));
   }
   void add(const std::vector<psibase::AccountNumber>& producers)
   {
      for (auto producer : producers)
      {
         add(producer);
      }
   }
   void partition(const NetworkPartition& groups, psibase::test::mock_clock::duration latency = {})
   {
      for (std::size_t i = 0; i < nodes.size(); ++i)
      {
         for (std::size_t j = i + 1; j < nodes.size(); ++j)
         {
            auto mask = (std::uint64_t(1) << i) | (std::uint64_t(1) << j);
            auto g1   = groups[nodes[i]->node.producer_name()];
            auto g2   = groups[nodes[j]->node.producer_name()];
            adjust_connection(nodes[i]->node, nodes[j]->node, g1 && g2 && *g1 == *g2, latency);
         }
      }
      PSIBASE_LOG(logger, info) << "connected nodes:" << groups;
   }
   template <std::invocable<std::vector<psibase::AccountNumber>> F>
   void partition(F&& f, psibase::test::mock_clock::duration latency = {})
   {
      std::vector<psibase::AccountNumber> prods;
      for (const auto& node : nodes)
      {
         prods.push_back(node->node.producer_name());
      }
      partition(f(std::move(prods)), latency);
   }
   static void adjust_connection(Node&                               lhs,
                                 Node&                               rhs,
                                 bool                                connect,
                                 psibase::test::mock_clock::duration latency)
   {
      if (lhs.has_peer(&rhs))
      {
         if (!connect)
         {
            lhs.remove_peer(&rhs);
         }
         // TODO: adjust latency
      }
      else if (connect)
      {
         lhs.add_peer(&rhs, latency);
      }
   }
   void connect_all(psibase::test::mock_clock::duration latency = {})
   {
      partition(NetworkPartition::all(), latency);
   }
   Node&                  operator[](std::size_t idx) { return nodes.at(idx)->node; }
   psibase::BlockContext* getBlockContext()
   {
      for (auto& n : nodes)
      {
         if (auto result = n->node.chain().getBlockContext())
            return result;
      }
      return nullptr;
   }
   boost::asio::io_context&                     ctx;
   std::vector<std::unique_ptr<TestNode<Node>>> nodes;
   psibase::loggers::common_logger              logger;
};

template <typename Node>
std::ostream& operator<<(std::ostream& os, const NodeSet<Node>& nodes)
{
   for (const auto& node : nodes.nodes)
   {
      if (!node->node.network()._peers.empty())
         os << ' ' << node->node.consensus().producer_name().str();
   }
   return os;
}

void pushTransaction(psibase::BlockContext* ctx, psibase::Transaction trx);
void setProducers(psibase::BlockContext* ctc, const psibase::Consensus& producers);

psibase::Transaction setProducers(const psibase::Consensus& producers);

std::vector<psibase::AccountNumber> makeAccounts(
    const std::vector<std::string_view>& producer_names);

void boot(psibase::BlockContext* ctx, const psibase::Consensus& producers);

template <typename C>
void boot(psibase::BlockContext* ctx, const std::vector<psibase::AccountNumber>& producers)
{
   C consensus;
   for (auto account : producers)
   {
      consensus.producers.push_back({account});
   }
   boot(ctx, consensus);
}

template <typename C>
void boot(psibase::BlockContext* ctx, const std::vector<std::string_view>& names)
{
   boot<C>(ctx, makeAccounts(names));
}

template <typename C, typename N>
void setup(NodeSet<N>& nodes, const std::vector<psibase::AccountNumber>& producers)
{
   for (auto prod : producers)
      nodes.add(prod);
   nodes.connect_all();
   boot<C>(nodes[0].chain().getBlockContext(), producers);
}

template <typename C, typename N>
void setup(NodeSet<N>& nodes, const std::vector<std::string_view>& producer_names)
{
   std::vector<psibase::AccountNumber> producers;
   for (auto prod : producer_names)
      producers.push_back(psibase::AccountNumber{prod});
   setup<C>(nodes, producers);
}

struct BlockArg
{
   BlockArg(const psibase::BlockInfo& info) : info(info) {}
   BlockArg(const BlockMessage& msg) : info(msg.block->block()) {}
                      operator psibase::BlockInfo() const { return info; }
   psibase::BlockInfo info;
};

BlockMessage makeBlock(const BlockArg& prev, std::string_view producer, psibase::TermNum view);
BlockMessage makeBlock(const BlockArg&             prev,
                       std::string_view            producer,
                       psibase::TermNum            view,
                       const psibase::Transaction& trx);
BlockMessage makeBlock(const BlockArg&     prev,
                       std::string_view    producer,
                       psibase::TermNum    view,
                       const BlockMessage& irreversible);
BlockMessage makeBlock(const BlockArg&                   info,
                       std::string_view                  producer,
                       psibase::TermNum                  view,
                       const psibase::net::BlockConfirm& irreversible);

psibase::net::BlockConfirm makeBlockConfirm(const BlockArg&                      committed,
                                            const std::vector<std::string_view>& prods,
                                            const std::vector<std::string_view>& next_prods);

SignedMessage<PrepareMessage> makePrepare(const BlockMessage& block, std::string_view producer);
SignedMessage<CommitMessage>  makeCommit(const BlockMessage& block, std::string_view producer);
ViewChangeMessage             makeViewChange(std::string_view producer, psibase::TermNum view);

void runFor(boost::asio::io_context& ctx, psibase::test::mock_clock::duration total_time);

template <typename Node>
struct SingleNode
{
   SingleNode(const std::vector<psibase::AccountNumber>& producers)
   {
      nodes.add(makeAccounts({"a", "main"}));
      nodes.partition(NetworkPartition::all());
      boot<psibase::BftConsensus>(nodes.getBlockContext(), producers);
      runFor(ctx, std::chrono::seconds(1));
   }
   SingleNode(const std::vector<std::string_view>& producers) : SingleNode(makeAccounts(producers))
   {
   }
   boost::asio::io_context ctx;
   NodeSet<Node>           nodes{ctx};

   void send(auto&& message)
   {
      nodes[1].sendto(nodes[0].producer_name(), message);
      ctx.poll();
   };
   auto head() { return nodes[0].chain().get_head_state()->info; }
};

#define TEST_START(logger)                                                              \
   psibase::loggers::common_logger logger;                                              \
   logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"})); \
   auto seed = psibase::test::global_random::make_seed();                               \
   INFO("seed: " << seed);                                                              \
   psibase::test::global_random::seed(seed);                                            \
   psibase::test::mock_clock::reset();
