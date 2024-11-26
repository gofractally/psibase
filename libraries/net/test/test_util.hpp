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
   void                  reset();
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
       : sharedState{std::make_shared<psibase::SharedState>(
             psibase::SharedDatabase{std::filesystem::temp_directory_path(),
                                     {1ull << 27, 1ull << 27, 1ull << 27, 1ull << 27},
                                     triedent::open_mode::temporary},
             psibase::WasmCache{16})}
   {
   }
   auto getSystemContext() { return sharedState->getSystemContext(); }
   std::shared_ptr<psibase::SharedState> sharedState;
};

template <typename Node>
struct TestNode
{
   TestNode(boost::asio::io_context&         ctx,
            psibase::AccountNumber           producer,
            std::shared_ptr<psibase::Prover> prover = std::make_shared<psibase::CompoundProver>())
       : system(db.getSystemContext()), node(ctx, system.get(), std::move(prover))
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
   auto  head() { return std::pair{node.chain().get_head_state(), system.get()}; }
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
   void add(psibase::AccountNumber           producer,
            std::shared_ptr<psibase::Prover> prover = std::make_shared<psibase::CompoundProver>())
   {
      nodes.push_back(std::make_unique<TestNode<Node>>(ctx, producer, std::move(prover)));
   }
   void add(const std::vector<psibase::AccountNumber>& producers,
            std::shared_ptr<psibase::Prover> prover = std::make_shared<psibase::CompoundProver>())
   {
      for (auto producer : producers)
      {
         add(producer, prover);
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
void setProducers(psibase::BlockContext* ctc, const psibase::ConsensusData& producers);

psibase::Transaction setProducers(const psibase::ConsensusData& producers);

std::vector<psibase::AccountNumber> makeAccounts(
    const std::vector<std::string_view>& producer_names);

auto makeBoot(const psibase::ConsensusData& producers,
              bool enableEcdsa = false) -> std::vector<psibase::SignedTransaction>;

template <typename Node>
void boot(Node& node, const psibase::ConsensusData& producers, bool enableEcdsa = false)
{
   psibase::TransactionTrace trace;
   node.push_boot(makeBoot(producers, enableEcdsa), trace);
   if (trace.error)
      throw std::runtime_error(std::move(*trace.error));
}

template <typename C, typename Node>
void boot(Node& node, const std::vector<psibase::AccountNumber>& producers)
{
   C consensus;
   for (auto account : producers)
   {
      consensus.producers.push_back({account});
   }
   boot(node, consensus);
}

template <typename C, typename Node>
void boot(Node& node, const std::vector<std::string_view>& names)
{
   boot<C>(node, makeAccounts(names));
}

template <typename C, typename N>
void setup(NodeSet<N>& nodes, const std::vector<psibase::AccountNumber>& producers)
{
   for (auto prod : producers)
      nodes.add(prod);
   nodes.connect_all();
   boot<C>(nodes[0], producers);
}

template <typename C, typename N>
void setup(NodeSet<N>& nodes, const std::vector<std::string_view>& producer_names)
{
   std::vector<psibase::AccountNumber> producers;
   for (auto prod : producer_names)
      producers.push_back(psibase::AccountNumber{prod});
   setup<C>(nodes, producers);
}

template <typename C>
psibase::ConsensusData makeConsensus(std::initializer_list<psibase::AccountNumber> names)
{
   C consensus;
   for (auto account : names)
   {
      consensus.producers.push_back({psibase::AccountNumber{account}});
   }
   return consensus;
}

auto cft(auto... args)
{
   return makeConsensus<psibase::CftConsensus>({psibase::AccountNumber(args)...});
}

auto bft(auto... args)
{
   return makeConsensus<psibase::BftConsensus>({psibase::AccountNumber(args)...});
}

struct TestBlock
{
   BlockMessage            block;
   psibase::JointConsensus state;
   operator BlockMessage() const { return block; }
   psibase::BlockInfo   info() const { return psibase::BlockInfo{block.block->block()}; }
   psibase::Checksum256 id() const { return info().blockId; }
};

struct BlockArg
{
   BlockArg(const TestBlock& block) : info(block.block.block->block()), state(block.state) {}
   BlockArg(std::pair<const psibase::BlockHeaderState*, psibase::SystemContext*> head)
       : info(head.first->info), state(head.first->readState(head.second))
   {
   }
   operator psibase::BlockInfo() const { return info; }
   BlockArg(const psio::shared_view_ptr<psibase::SignedBlock>& block) : info(block->block()) {}
   psibase::BlockInfo      info;
   psibase::JointConsensus state;
};

TestBlock makeBlock(const BlockArg& prev, std::string_view producer, psibase::TermNum view);
TestBlock makeBlock(const BlockArg&             prev,
                    std::string_view            producer,
                    psibase::TermNum            view,
                    const psibase::Transaction& trx);
TestBlock makeBlock(const BlockArg&     prev,
                    std::string_view    producer,
                    psibase::TermNum    view,
                    const BlockMessage& irreversible);
TestBlock makeBlock(const BlockArg&                   info,
                    std::string_view                  producer,
                    psibase::TermNum                  view,
                    const psibase::net::BlockConfirm& irreversible);

psibase::net::BlockConfirm makeBlockConfirm(const BlockArg&                      committed,
                                            const std::vector<std::string_view>& prods,
                                            const std::vector<std::string_view>& next_prods);

SignedMessage<PrepareMessage> makePrepare(const BlockMessage& block, std::string_view producer);
SignedMessage<CommitMessage>  makeCommit(const BlockMessage& block, std::string_view producer);
ViewChangeMessage             makeViewChange(std::string_view producer, psibase::TermNum view);
ViewChangeMessage             makeViewChange(std::string_view                        producer,
                                             psibase::TermNum                        view,
                                             const psibase::BlockInfo&               prepared,
                                             std::initializer_list<std::string_view> preparers);

void runFor(boost::asio::io_context& ctx, psibase::test::mock_clock::duration total_time);

template <typename Node>
struct SingleNode
{
   SingleNode(const std::vector<psibase::AccountNumber>& producers)
   {
      nodes.add(makeAccounts({"a", "main"}));
      nodes.partition(NetworkPartition::all());
      boot<psibase::BftConsensus>(nodes[0], producers);
      runFor(ctx, std::chrono::seconds(1));
   }
   SingleNode(const std::vector<std::string_view>& producers) : SingleNode(makeAccounts(producers))
   {
   }
   boost::asio::io_context ctx;
   NodeSet<Node>           nodes{ctx};

   void addClient()
   {
      nodes.add(psibase::AccountNumber{"client"});
      NodeSet<Node>::adjust_connection(nodes[0], nodes[2], true, {});
   }
   void send(auto&& message)
   {
      nodes[1].sendto(nodes[0].producer_name(), message);
      ctx.poll();
   };
   void send(TestBlock& message) { send(message.block); };
   void send0(auto&& message) { nodes[1].sendto(nodes[0].producer_name(), message); }
   void send0(TestBlock& message) { send0(message.block); }
   void poll() { ctx.poll(); }
   auto head() { return nodes[0].chain().get_head_state()->info; }
   auto clientHead() { return nodes[2].chain().get_head_state()->info; }
   auto headState() { return nodes.nodes[0]->head(); }
};

#define TEST_START(logger)                                                              \
   psibase::loggers::common_logger logger;                                              \
   logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"})); \
   auto seed = psibase::test::global_random::make_seed();                               \
   INFO("rng-seed: " << seed);                                                          \
   psibase::test::global_random::seed(seed);                                            \
   psibase::test::mock_clock::reset();

extern std::optional<std::size_t> dataIndex;

#define GENERATE_INDEX(container) \
   (::dataIndex ? *::dataIndex : GENERATE(range(std::size_t(0), (container).size())))
