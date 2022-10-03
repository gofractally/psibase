#include <psibase/EcdsaProver.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/cft.hpp>
#include <psibase/direct_routing.hpp>
#include <psibase/http.hpp>
#include <psibase/log.hpp>
#include <psibase/node.hpp>
#include <psibase/peer_manager.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/websocket.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <boost/asio/system_timer.hpp>

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;
using namespace psibase::net;

namespace psibase
{
   void validate(boost::any& v, const std::vector<std::string>& values, PrivateKey*, int)
   {
      boost::program_options::validators::check_first_occurrence(v);
      v = privateKeyFromString(boost::program_options::validators::get_single_string(values));
   }
}  // namespace psibase

struct transaction_queue
{
   struct entry
   {
      bool                            is_boot = false;
      std::vector<char>               packed_signed_trx;
      http::push_boot_callback        boot_callback;
      http::push_transaction_callback callback;
   };

   std::mutex         mutex;
   std::vector<entry> entries;
};

#define RETHROW_BAD_ALLOC  \
   catch (std::bad_alloc&) \
   {                       \
      throw;               \
   }

#define CATCH_IGNORE \
   catch (...) {}

bool push_boot(BlockContext& bc, transaction_queue::entry& entry)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto transactions =
          psio::convert_from_frac<std::vector<SignedTransaction>>(entry.packed_signed_trx);
      TransactionTrace trace;

      try
      {
         if (!bc.needGenesisAction)
         {
            trace.error = "chain is already booted";
         }
         else
         {
            for (auto& trx : transactions)
            {
               trace = {};
               if (!trx.proofs.empty())
                  // Proofs execute as of the state at the beginning of a block.
                  // That state is empty, so there are no proof services installed.
                  trace.error = "Transactions in boot block may not have proofs";
               else
                  bc.pushTransaction(trx, trace, std::nullopt);
            }
         }
      }
      RETHROW_BAD_ALLOC
      catch (...)
      {
         // Don't give a false positive
         if (!trace.error)
            throw;
      }

      try
      {
         if (trace.error)
         {
            entry.boot_callback(std::move(trace.error));
         }
         else
         {
            entry.boot_callback(std::nullopt);
            return true;
         }
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   RETHROW_BAD_ALLOC
   catch (std::exception& e)
   {
      try
      {
         entry.boot_callback(e.what());
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   catch (...)
   {
      try
      {
         entry.boot_callback("unknown error");
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   return false;
}  // push_boot

template <typename Timer, typename F>
void loop(Timer& timer, F&& f)
{
   using namespace std::literals::chrono_literals;
   timer.expires_after(100ms);
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

void pushTransaction(psibase::SharedState&                  sharedState,
                     const std::shared_ptr<const Revision>& revisionAtBlockStart,
                     BlockContext&                          bc,
                     SystemContext&                         proofSystem,
                     transaction_queue::entry&              entry,
                     std::chrono::microseconds              firstAuthWatchdogLimit,
                     std::chrono::microseconds              proofWatchdogLimit,
                     std::chrono::microseconds              initialWatchdogLimit)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto             trx = psio::convert_from_frac<SignedTransaction>(entry.packed_signed_trx);
      TransactionTrace trace;

      try
      {
         if (bc.needGenesisAction)
            trace.error = "Need genesis block; use 'psibase boot' to boot chain";
         else
         {
            // All proofs execute as of the state at block begin. This will allow
            // consistent parallel execution of all proofs within a block during
            // replay. Proofs don't have direct database access, but they do rely
            // on the set of services stored within the database. They may call
            // other services; e.g. to call crypto functions.
            //
            // TODO: move proof execution to background threads
            // TODO: track CPU usage of proofs and pass it somehow to the main
            //       execution for charging
            // TODO: If by the time the transaction executes it's on a different
            //       block than the proofs were verified on, then either the proofs
            //       need to be rerun, or the hashes of the services which ran
            //       during the proofs need to be compared against the current
            //       service hashes. This will prevent a poison block.
            // TODO: If the first proof and the first auth pass, but the transaction
            //       fails (including other proof failures), then charge the first
            //       authorizer
            BlockContext proofBC{proofSystem, revisionAtBlockStart};
            proofBC.start(bc.current.header.time);
            for (size_t i = 0; i < trx.proofs.size(); ++i)
            {
               proofBC.verifyProof(trx, trace, i, proofWatchdogLimit);
               trace = {};
            }

            // TODO: in another thread: check first auth and first proof. After
            //       they pass, schedule the remaining proofs. After they pass,
            //       schedule the transaction for execution in the main thread.
            //
            // The first auth check is a prefiltering measure and is mostly redundant
            // with main execution. Unlike the proofs, the first auth check is allowed
            // to run with any state on any fork. This is OK since the main execution
            // checks all auths including the first; the worst that could happen is
            // the transaction being rejected because it passes on one fork but not
            // another, potentially charging the user for the failed transaction. The
            // first auth check, when not part of the main execution, runs in read-only
            // mode. TransactionSys lets the account's auth service know it's in a
            // read-only mode so it doesn't fail the transaction trying to update its
            // tables.
            //
            // Replay doesn't run the first auth check separately. This separate
            // execution is a subjective measure; it's possible, but not advisable,
            // for a modified node to skip it during production. This won't hurt
            // consensus since replay never uses read-only mode for auth checks.
            auto saveTrace = trace;
            proofBC.checkFirstAuth(trx, trace, firstAuthWatchdogLimit);
            trace = std::move(saveTrace);

            // TODO: RPC: don't forward failed transactions to P2P; this gives users
            //       feedback.
            // TODO: P2P: do forward failed transactions; this enables producers to
            //       bill failed transactions which have tied up P2P nodes.
            // TODO: If the first authorizer doesn't have enough to bill for failure,
            //       then drop before running any other checks. Don't propagate.
            // TODO: Don't propagate failed transactions which have
            //       do_not_broadcast_flag.
            // TODO: Revisit all of this. It doesn't appear to eliminate the need to
            //       shadow bill, and once shadow billing is in place, failed
            //       transaction billing seems unnecessary.

            bc.pushTransaction(trx, trace, initialWatchdogLimit);
         }
      }
      RETHROW_BAD_ALLOC
      catch (...)
      {
         // Don't give a false positive
         if (!trace.error)
            throw;
      }

      try
      {
         entry.callback(std::move(trace));
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   RETHROW_BAD_ALLOC
   catch (std::exception& e)
   {
      try
      {
         entry.callback(e.what());
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   catch (...)
   {
      try
      {
         entry.callback("unknown error");
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
}  // pushTransaction

std::pair<std::string_view, std::string_view> parse_endpoint(std::string_view peer)
{
   // TODO: handle ipv6 addresses [addr]:port
   // TODO: use a websocket URI
   auto pos = peer.find(':');
   if (pos == std::string_view::npos)
   {
      return {peer, "8080"};
   }
   else
   {
      return {peer.substr(0, pos), peer.substr(pos + 1)};
   }
}

using timer_type = boost::asio::system_timer;

template <typename Derived>
using cft_consensus = basic_cft_consensus<Derived, timer_type>;

const char default_config[] = R"(# psinode configuration

slow     = no
p2p      = off
# producer = psibase
# sign     = <private key>
# host     = 127.0.0.1.sslip.io
# port     = 8080
# peer     = localhost:8080

[logger.stderr]
type         = console
filter       = %Severity% >= info
format       = [%TimeStamp%] [%Severity%]: %Message%
format.p2p   = [%TimeStamp%] [%Severity%] [%RemoteEndpoint%]: %Message%
format.block = [%TimeStamp%] [%Severity%]: %Message% %BlockId%
)";

void run(const std::string&              db_path,
         AccountNumber                   producer,
         std::shared_ptr<Prover>         prover,
         const std::vector<std::string>& peers,
         bool                            enable_incoming_p2p,
         const std::string&              host,
         unsigned short                  port,
         bool                            host_perf,
         uint32_t                        leeway_us,
         bool                            allow_slow,
         const std::string&              replay_blocks,
         const std::string&              save_blocks)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   auto sharedState =
       std::make_shared<psibase::SharedState>(SharedDatabase{db_path, allow_slow}, WasmCache{128});
   auto system      = sharedState->getSystemContext();
   auto proofSystem = sharedState->getSystemContext();
   auto queue       = std::make_shared<transaction_queue>();

   // If the server's config file doesn't exist yet, create it
   {
      auto config_path = std::filesystem::path(db_path) / "config";
      if (!std::filesystem::exists(config_path))
      {
         std::ofstream out(config_path);
         out << default_config;
      }
   }

   boost::asio::io_context chainContext;

   using node_type = node<peer_manager, direct_routing, cft_consensus, ForkDb>;
   node_type node(chainContext, system.get(), std::move(prover));
   node.set_producer_id(producer);
   node.load_producers();

   // Used for outgoing connections
   boost::asio::ip::tcp::resolver resolver(chainContext);

   auto http_config = std::make_shared<http::http_config>();
   if (!host.empty())
   {
      // TODO: command-line options
      http_config->num_threads      = 4;
      http_config->max_request_size = 20 * 1024 * 1024;
      http_config->idle_timeout_ms  = std::chrono::milliseconds{4000};
      http_config->allow_origin     = "*";
      http_config->address          = "0.0.0.0";
      http_config->port             = port;
      http_config->host             = host;
      http_config->host_perf        = host_perf;

      // TODO: speculative execution on non-producers
      if (producer != AccountNumber{})
      {
         http_config->push_boot_async = [queue](std::vector<char>        packed_signed_transactions,
                                                http::push_boot_callback callback)
         {
            std::scoped_lock lock{queue->mutex};
            queue->entries.push_back(
                {true, std::move(packed_signed_transactions), std::move(callback), {}});
         };

         http_config->push_transaction_async =
             [queue](std::vector<char> packed_signed_trx, http::push_transaction_callback callback)
         {
            std::scoped_lock lock{queue->mutex};
            queue->entries.push_back(
                {false, std::move(packed_signed_trx), {}, std::move(callback)});
         };
      }

      // TODO: The websocket uses the http server's io_context, but does not
      // do anything to keep it alive. Stopping the server doesn't close the
      // websocket either.
      if (enable_incoming_p2p)
         http_config->accept_p2p_websocket = [&node](auto&& stream)
         { node.add_connection(std::make_shared<websocket_connection>(std::move(stream))); };

      http_config->get_peers = [&chainContext, &node](http::get_peers_callback callback)
      {
         boost::asio::post(chainContext,
                           [&chainContext, &node, callback = std::move(callback)]
                           {
                              http::get_peers_result result;
                              for (const auto& [id, conn] : node.peers().connections())
                              {
                                 result.push_back({id, conn->endpoint()});
                              }
                              callback(std::move(result));
                           });
      };

      http_config->connect =
          [&chainContext, &node, &resolver](std::vector<char> peer, http::connect_callback callback)
      {
         boost::asio::post(chainContext,
                           [&chainContext, &node, &resolver, peer = std::move(peer),
                            callback = std::move(callback)]() mutable
                           {
                              auto [host, service] = parse_endpoint({peer.data(), peer.size()});
                              async_connect(std::make_shared<websocket_connection>(chainContext),
                                            resolver, host, service,
                                            [&node](auto&& conn)
                                            { node.add_connection(std::move(conn)); });
                              callback(std::nullopt);
                           });
      };

      http_config->disconnect =
          [&chainContext, &node, &resolver](std::vector<char> peer, http::connect_callback callback)
      {
         boost::asio::post(
             chainContext,
             [&chainContext, &node, &resolver, peer = std::move(peer),
              callback = std::move(callback)]() mutable
             {
                int  id;
                auto result  = std::from_chars(peer.data(), peer.data() + peer.size(), id);
                auto message = "Unknown peer";
                if (result.ec != std::errc() || result.ptr != peer.data() + peer.size())
                {
                   callback(message);
                }
                else
                {
                   if (!node.peers().disconnect(id))
                   {
                      callback(message);
                   }
                   else
                   {
                      callback(std::nullopt);
                   }
                }
             });
      };

      auto server = http::server::create(http_config, sharedState);
   }

   if (!replay_blocks.empty())
   {
      PSIBASE_LOG(node.chain().getLogger(), info) << "Replaying blocks from " << replay_blocks;
      std::fstream file(replay_blocks, std::ios_base::binary | std::ios_base::in);
      if (!file.is_open())
         throw std::runtime_error("failed to open " + replay_blocks);

      Database                db{system->sharedDatabase, system->sharedDatabase.getHead()};
      auto                    session = db.startRead();
      std::optional<BlockNum> skipping;
      std::vector<char>       raw;
      while (true)
      {
         uint64_t size;
         if (!file.read((char*)&size, sizeof(size)))
            break;
         raw.resize(size);
         if (!file.read(raw.data(), raw.size()))
            break;
         SignedBlock sb;
         sb.block = psio::convert_from_frac<Block>(raw);
         BlockInfo info{sb.block};

         bool foundExisting = node.chain().get_state(info.blockId);
         if (!foundExisting)
            if (auto existing = db.kvGet<Block>(DbId::blockLog, info.header.blockNum))
               if (info.blockId == BlockInfo{*existing}.blockId)
                  foundExisting = true;

         if (foundExisting)
         {
            if (!skipping)
            {
               PSIBASE_LOG(node.chain().getLogger(), info) << "Skipping existing blocks";
               skipping = info.header.blockNum;
            }
            continue;
         }
         if (skipping)
         {
            PSIBASE_LOG(node.chain().getLogger(), info) << "Skipped existing blocks " << *skipping
                                                        << "-" << info.header.blockNum - 1 << "\n";
            skipping = std::nullopt;
         }

         if (!node.chain().insert(sb))
            throw std::runtime_error(
                "Block " + psio::convert_to_json(info.blockId) +
                " failed to link; most likely it tries to fork out an irreversible block");
         node.chain().async_switch_fork(
             [&node, &info](BlockHeader* h)
             {
                node.consensus().on_fork_switch(h);
                node.chain().commit(info.header.blockNum);
             });
      }
   }

   node.set_producer_id(producer);
   http_config->ready_for_p2p = true;

   bool showedBootMsg = false;

   for (const std::string& peer : peers)
   {
      auto [host, service] = parse_endpoint(peer);
      //node.async_connect(peer.substr(0, pos), peer.substr(pos + 1));
      async_connect(std::make_shared<websocket_connection>(chainContext), resolver, host, service,
                    [&node](auto&& conn) { node.add_connection(std::move(conn)); });
   }

   if (!save_blocks.empty())
   {
      PSIBASE_LOG(node.chain().getLogger(), info) << "Saving blocks to " << save_blocks;
      std::fstream file(save_blocks,
                        std::ios_base::binary | std::ios_base::out | std::ios_base::trunc);
      if (!file.is_open())
         throw std::runtime_error("failed to open " + save_blocks);

      Database db{system->sharedDatabase, system->sharedDatabase.getHead()};
      auto     session    = db.startRead();
      BlockNum num        = 2;
      int      numWritten = 0;
      while (auto block = db.kvGetRaw(DbId::blockLog, psio::convert_to_key(num)))
      {
         if (num == 2 || !(num % 10000))
            PSIBASE_LOG(node.chain().getLogger(), info)
                << "writing block " << num << " to " << save_blocks;
         uint64_t size = block->remaining();
         file.write((char*)&size, sizeof(size));
         file.write(block->pos, block->remaining());
         ++num;
         ++numWritten;
      }
      PSIBASE_LOG(node.chain().getLogger(), info)
          << "wrote " << numWritten << " blocks to " << save_blocks;
   }

   timer_type timer(chainContext);

   // TODO: post the transactions to chainContext rather than batching them at fixed intervals.
   auto process_transactions = [&]()
   {
      std::vector<transaction_queue::entry> entries;
      {
         std::scoped_lock lock{queue->mutex};
         std::swap(entries, queue->entries);
      }
      if (auto bc = node.chain().getBlockContext())
      {
         auto revisionAtBlockStart = node.chain().getHeadRevision();
         for (auto& entry : entries)
         {
            if (entry.is_boot)
               push_boot(*bc, entry);
            else
               pushTransaction(*sharedState, revisionAtBlockStart, *bc, *proofSystem, entry,
                               std::chrono::microseconds(leeway_us),  // TODO
                               std::chrono::microseconds(leeway_us),  // TODO
                               std::chrono::microseconds(leeway_us));
         }

         // TODO: this should go in the leader's production loop
         if (bc->needGenesisAction)
         {
            if (!showedBootMsg)
            {
               PSIBASE_LOG(node.chain().getLogger(), notice)
                   << "Need genesis block; use 'psibase boot' to boot chain";
               showedBootMsg = true;
            }
            //continue;
         }
      }
      else
      {
         for (auto& entry : entries)
         {
            std::string message = "Only the current leader accepts transactions";
            if (entry.callback)
            {
               entry.callback(message);
            }
            else if (entry.boot_callback)
            {
               entry.boot_callback(message);
            }
         }
      }
   };
   loop(timer, process_transactions);

   chainContext.run();
}

const char usage[] = "USAGE: psinode [OPTIONS] database";

int main(int argc, char* argv[])
{
   std::string              db_path;
   std::string              producer = {};
   std::vector<PrivateKey>  keys;
   std::string              host       = {};
   unsigned short           port       = 8080;
   bool                     host_perf  = false;
   uint32_t                 leeway_us  = 200000;  // TODO: real value once resources are in place
   bool                     allow_slow = false;
   std::vector<std::string> peers;
   bool                     enable_incoming_p2p = false;
   std::string              replay_blocks       = {};
   std::string              save_blocks         = {};

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   po::options_description common_opts("psinode");
   auto                    opt = common_opts.add_options();
   opt("producer,p", po::value<std::string>(&producer), "Name of this producer");
   opt("sign,s", po::value(&keys), "Sign with this key");
   opt("peer", po::value(&peers), "Peer endpoint");
   opt("p2p", po::bool_switch(&enable_incoming_p2p),
       "Enable incoming p2p connections; requires --host");
   opt("host,o", po::value<std::string>(&host)->value_name("name"), "Host http server");
   opt("port", po::value(&port), "http server port");
   opt("host-perf,O", po::bool_switch(&host_perf), "Show various hosting metrics");
   opt("leeway,l", po::value<uint32_t>(&leeway_us),
       "Transaction leeway, in us. Defaults to 200000.");
   opt("slow", po::bool_switch(&allow_slow),
       "Don't complain if unable to lock memory for database. This will still attempt to lock "
       "memory, but if it fails it will continue to run, but more slowly.");
   desc.add(common_opts);
   opt = desc.add_options();
   // Options that can only be specified on the command line
   opt("database", po::value<std::string>(&db_path)->value_name("path")->required(),
       "Path to database");
   opt("replay-blocks", po::value<std::string>(&replay_blocks)->value_name("file"),
       "Replay blocks from file");
   opt("save-blocks", po::value<std::string>(&save_blocks)->value_name("file"),
       "Save blocks to file");
   opt("help,h", "Show this message");

   po::positional_options_description p;
   p.add("database", 1);

   // Options that are only allowed in the config file
   po::options_description cfg_opts("psinode");
   cfg_opts.add(common_opts);
   cfg_opts.add_options()("logger.*", po::value<std::string>(), "Log configuration");

   po::variables_map vm;
   try
   {
      po::store(po::command_line_parser(argc, argv).options(desc).positional(p).run(), vm);
      if (vm.count("database"))
      {
         auto config_path = std::filesystem::path(vm["database"].as<std::string>()) / "config";
         if (std::filesystem::is_regular_file(config_path))
         {
            std::ifstream in(config_path);
            po::store(po::parse_config_file(in, cfg_opts), vm);
         }
      }
      po::notify(vm);
   }
   catch (std::exception& e)
   {
      if (!vm.count("help"))
      {
         std::cerr << e.what() << "\n";
         return 1;
      }
   }

   if (vm.count("help"))
   {
      std::cerr << usage << "\n\n";
      std::cerr << desc << "\n";
      return 1;
   }

   try
   {
      psibase::loggers::set_path(db_path);
      psibase::loggers::configure(vm);
      psibase::loggers::configure_default();
      auto prover = std::make_shared<CompoundProver>();
      for (const auto& key : keys)
      {
         prover->provers.push_back(
             std::make_shared<EcdsaSecp256K1Sha256Prover>(AccountNumber{"verifyec-sys"}, key));
      }
      run(db_path, AccountNumber{producer}, prover, peers, enable_incoming_p2p, host, port,
          host_perf, leeway_us, allow_slow, replay_blocks, save_blocks);
      return 0;
   }
   catch (std::exception& e)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), error) << e.what();
   }
   return 1;
}
