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
   AccountNumber           ida{"a"};
   AccountNumber           idb{"b"};
   AccountNumber           idc{"c"};
   TestNode                a(ctx, ida);
   TestNode                b(ctx, idb);
   TestNode                c(ctx, idc);
   a.node.add_peer(&b.node);
   a.node.add_peer(&c.node);
   b.node.add_peer(&c.node);

   boot(a.node.chain().getBlockContext(), {ida, idb, idc});

   int        active_set = 7;
   timer_type timer(ctx);
   auto       adjust_connection = [&](TestNode* n1, TestNode* n2, bool old_state, bool new_state)
   {
      if (old_state && !new_state)
      {
         n1->node.remove_peer(&n2->node);
      }
      else if (!old_state && new_state)
      {
         n1->node.add_peer(&n2->node);
      }
   };
   std::mt19937 rng;
   loop(timer,
        [&]()
        {
           std::uniform_int_distribution<> dist(0, 7);
           auto                            next_set = dist(rng);
           PSIBASE_LOG(logger, info)
               << "active nodes:" << ((next_set & 1) ? " a" : "") << ((next_set & 2) ? " b" : "")
               << ((next_set & 4) ? " c" : "");
           adjust_connection(&a, &b, (active_set & 3) == 3, (next_set & 3) == 3);
           adjust_connection(&a, &c, (active_set & 5) == 5, (next_set & 5) == 5);
           adjust_connection(&b, &c, (active_set & 6) == 6, (next_set & 6) == 6);
           active_set = next_set;
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
   adjust_connection(&a, &b, (active_set & 3) == 3, true);
   adjust_connection(&a, &c, (active_set & 5) == 5, true);
   adjust_connection(&b, &c, (active_set & 6) == 6, true);
   active_set = 7;
   run_for(10s);

   auto final_state = a.chain().get_head_state();
   // Verify that all three chains are consistent
   CHECK(final_state->blockId() == b.chain().get_head_state()->blockId());
   CHECK(final_state->blockId() == c.chain().get_head_state()->blockId());
   // Verify that the final block looks sane
   mock_clock::time_point final_time{std::chrono::seconds{final_state->info.header.time.seconds}};
   CHECK(final_time <= mock_clock::now());
   CHECK(final_time >= mock_clock::now() - 2s);
   CHECK(final_state->info.header.commitNum == final_state->info.header.blockNum - 2);
}
