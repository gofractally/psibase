#include <psibase/cft.hpp>
#include <psibase/fork_database.hpp>
#include <psibase/mock_routing.hpp>
#include <psibase/mock_timer.hpp>
#include <psibase/node.hpp>

#include <psibase/Actor.hpp>
#include <psibase/nativeTables.hpp>

#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/ProducerSys.hpp>
#include <services/system/TransactionSys.hpp>

#include <boost/asio/io_context.hpp>
#include <boost/asio/steady_timer.hpp>

#include <filesystem>
#include <random>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;
using namespace SystemService;

template <>
struct Catch::StringMaker<Checksum256>
{
   static std::string convert(const Checksum256& obj) { return loggers::to_string(obj); }
};

template <typename Derived>
struct null_link
{
   explicit null_link(boost::asio::io_context&) {}
};

using timer_type = mock_timer;
//using timer_type = boost::asio::steady_timer;

template <typename Derived>
using cft_consensus = basic_cft_consensus<blocknet<Derived, timer_type>, timer_type>;

template <typename Timer, typename F>
void loop(Timer& timer, F&& f)
{
   using namespace std::literals::chrono_literals;
   timer.expires_after(10s);
   timer.async_wait(
       [&timer, f](const std::error_code& e)
       {
          if (!e)
          {
             f();
             loop(timer, f);
          }
       });
}

std::filesystem::path randomDirName(std::string_view name)
{
   std::random_device rng;
   for (int tries = 0; tries < 5; ++tries)
   {
      auto suffix = rng() % 1000000;
      auto tmp =
          std::filesystem::temp_directory_path() / (std::string(name) + std::to_string(suffix));
      if (!std::filesystem::exists(tmp))
         return tmp;
   }
   throw std::runtime_error("Failed to find unique temp directory");
}

struct TempDir
{
   explicit TempDir(std::string_view name) : path(randomDirName(name)) {}
   ~TempDir() { std::filesystem::remove_all(path); }
   std::filesystem::path path;
};

struct TempDatabase
{
   TempDatabase()
       : dir("psibase-test"),
         sharedState{std::make_shared<psibase::SharedState>(SharedDatabase{dir.path.native(), true},
                                                            WasmCache{16})}
   {
   }
   auto    getSystemContext() { return sharedState->getSystemContext(); }
   TempDir dir;
   std::shared_ptr<psibase::SharedState> sharedState;
};

using node_type = node<null_link, mock_routing, cft_consensus, ForkDb>;

struct TestNode
{
   TestNode(boost::asio::io_context& ctx, AccountNumber producer)
       : system(db.getSystemContext()), node(ctx, system.get())
   {
      auto attr = boost::log::attributes::constant(producer.str());
      node.chain().getBlockLogger().add_attribute("Host", attr);
      node.chain().getLogger().add_attribute("Host", attr);
      node.consensus().logger.add_attribute("Host", attr);
      node.network().logger.add_attribute("Host", attr);
      node.set_producer_id(producer);
      node.load_producers();
   }
   TempDatabase                   db;
   std::unique_ptr<SystemContext> system;
   node_type                      node;
   auto&                          chain() { return node.chain(); }
};

struct NodeSet
{
   explicit NodeSet(boost::asio::io_context& ctx) : ctx(ctx) {}
   void add(AccountNumber producer) { nodes.push_back(std::make_unique<TestNode>(ctx, producer)); }
   template <typename Engine>
   void randomize(Engine& rng)
   {
      assert(nodes.size() < 64);
      std::uniform_int_distribution dist{std::uint64_t{0}, (std::uint64_t(1) << nodes.size()) - 1};
      auto                          bitset = dist(rng);
      for (std::size_t i = 0; i < nodes.size(); ++i)
      {
         for (std::size_t j = i + 1; j < nodes.size(); ++j)
         {
            auto mask = (std::uint64_t(1) << i) | (std::uint64_t(1) << j);
            adjust_connection(nodes[i]->node, nodes[j]->node, (bitset & mask) == mask);
         }
      }
   }
   static void adjust_connection(node_type& lhs, node_type& rhs, bool connect)
   {
      if (lhs.has_peer(&rhs))
      {
         if (!connect)
         {
            lhs.remove_peer(&rhs);
         }
      }
      else if (connect)
      {
         lhs.add_peer(&rhs);
      }
   }
   void connect_all()
   {
      for (std::size_t i = 0; i < nodes.size(); ++i)
      {
         for (std::size_t j = i + 1; j < nodes.size(); ++j)
         {
            adjust_connection(nodes[i]->node, nodes[j]->node, true);
         }
      }
   }
   node_type&               operator[](std::size_t idx) { return nodes.at(idx)->node; }
   boost::asio::io_context& ctx;
   std::vector<std::unique_ptr<TestNode>> nodes;
};

std::ostream& operator<<(std::ostream& os, const NodeSet& nodes)
{
   for (const auto& node : nodes.nodes)
   {
      if (!node->node.network()._peers.empty())
         os << ' ' << node->node.consensus().producer_name().str();
   }
   return os;
}

std::vector<char> readWholeFile(const std::filesystem::path& name)
{
   std::ifstream     in(name);
   std::vector<char> result;
   std::copy(std::istreambuf_iterator<char>(in.rdbuf()), std::istreambuf_iterator<char>(),
             std::back_inserter(result));
   return result;
}

void pushBootTransaction(BlockContext* ctx, Transaction trx)
{
   SignedTransaction strx{.transaction = trx};
   TransactionTrace  trace;
   ctx->pushTransaction(strx, trace, std::nullopt);
}

void boot(BlockContext* ctx, const std::vector<AccountNumber>& producers = {})
{
   // TransactionSys + ProducerSys + AuthAnySys + AccountSys
   pushBootTransaction(
       ctx,
       Transaction{
           //
           .actions = {                                             //
                       Action{.sender  = AccountNumber{"psibase"},  // ignored
                              .service = AccountNumber{"psibase"},  // ignored
                              .method  = MethodNumber{"boot"},
                              .rawData = psio::convert_to_frac(GenesisActionData{
                                  .services = {{
                                                   .service = TransactionSys::service,
                                                   .flags   = TransactionSys::serviceFlags,
                                                   .code    = readWholeFile("TransactionSys.wasm"),
                                               },
                                               {
                                                   .service = AccountSys::service,
                                                   .flags   = 0,
                                                   .code    = readWholeFile("AccountSys.wasm"),
                                               },
                                               {
                                                   .service = ProducerSys::service,
                                                   .flags   = ProducerSys::serviceFlags,
                                                   .code    = readWholeFile("ProducerSys.wasm"),
                                               },
                                               {
                                                   .service = AuthAnySys::service,
                                                   .flags   = 0,
                                                   .code    = readWholeFile("AuthAnySys.wasm"),
                                               }}})}}});
   std::vector<psibase::Producer> producerAuth;
   for (auto account : producers)
   {
      producerAuth.push_back({account});
   }
   pushBootTransaction(
       ctx,
       Transaction{.tapos   = {.expiration = {ctx->current.header.time.seconds + 1}},
                   .actions = {Action{.sender  = AccountSys::service,
                                      .service = AccountSys::service,
                                      .method  = MethodNumber{"init"},
                                      .rawData = psio::to_frac(std::tuple())},
                               Action{.sender  = TransactionSys::service,
                                      .service = TransactionSys::service,
                                      .method  = MethodNumber{"init"},
                                      .rawData = psio::to_frac(std::tuple())},
                               transactor<ProducerSys>(ProducerSys::service, ProducerSys::service)
                                   .setProducers(producerAuth)}});
}

const char* log_config = R"(
{
  "stderr": {
    "type": "console",
    "filter": "Severity >= info",
    "format": "[{Severity}] [{Host}]: {Message}{?: {BlockId}: {BlockHeader}}"
  }
}
)";

TEST_CASE("random connect/disconnect")
{
   ExecutionContext::registerHostFunctions();
   loggers::configure(psio::convert_from_json<loggers::Config>(log_config));
   // loggers::configure(loggers::Config());
   loggers::common_logger logger;
   logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"}));
   boost::asio::io_context ctx;
   NodeSet                 nodes(ctx);
   AccountNumber           ida{"a"};
   AccountNumber           idb{"b"};
   AccountNumber           idc{"c"};
   nodes.add(ida);
   nodes.add(idb);
   nodes.add(idc);
   nodes.connect_all();

   boot(nodes[0].chain().getBlockContext(), {ida, idb, idc});

   timer_type   timer(ctx);
   std::mt19937 rng;
   loop(timer,
        [&]()
        {
           nodes.randomize(rng);
           PSIBASE_LOG(logger, info) << "connected nodes:" << nodes;
        });
   // This should result in a steady stream of empty blocks
   auto run_for = [&](auto total_time)
   {
      for (auto end = mock_clock::now() + total_time; mock_clock::now() < end;
           mock_clock::advance())
      {
         ctx.poll();
      }
   };
   run_for(std::chrono::minutes(5));
   timer.cancel();
   ctx.poll();

   PSIBASE_LOG(logger, info) << "Final sync";
   using namespace std::literals::chrono_literals;
   // Make all nodes active
   nodes.connect_all();
   run_for(10s);

   auto final_state = nodes[0].chain().get_head_state();
   // Verify that all three chains are consistent
   CHECK(final_state->blockId() == nodes[1].chain().get_head_state()->blockId());
   CHECK(final_state->blockId() == nodes[2].chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum == final_state->info.header.blockNum - 2);
}
