#include <psibase/TransactionContext.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/cft.hpp>
#include <psibase/node.hpp>
#include <psibase/direct_routing.hpp>
#include <psibase/http.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <boost/asio/system_timer.hpp>

#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;
using namespace psibase::net;

std::vector<char> read_whole_file(const char* filename)
{
   FILE* f = fopen(filename, "r");
   if (!f)
      throw std::runtime_error("error reading file " + std::string(filename));
   psio::finally fin{[&] { fclose(f); }};

   if (fseek(f, 0, SEEK_END))
      throw std::runtime_error("error reading file " + std::string(filename));
   auto size = ftell(f);
   if (size < 0)
      throw std::runtime_error("error reading file " + std::string(filename));
   if (fseek(f, 0, SEEK_SET))
      throw std::runtime_error("error reading file " + std::string(filename));
   std::vector<char> buf(size);
   if (fread(buf.data(), size, 1, f) != 1)
      throw std::runtime_error("error reading file " + std::string(filename));
   return buf;
}

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
                  // That state is empty, so there are no proof contracts installed.
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

template<typename Timer, typename F>
void loop(Timer& timer, F&& f)
{
   using namespace std::literals::chrono_literals;
   timer.expires_after(100ms);
   timer.async_wait([&timer, f](const std::error_code& e){
      if(!e)
      {
         f();
         loop(timer, f);
      }
   });
}

void pushTransaction(psibase::SharedState&                  sharedState,
                     const std::shared_ptr<const Revision>& revisionAtBlockStart,
                     BlockContext&                          bc,
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
            // on the set of contracts stored within the database. They may call
            // other contracts; e.g. to call crypto functions.
            //
            // TODO: move proof execution to background threads
            // TODO: track CPU usage of proofs and pass it somehow to the main
            //       execution for charging
            // TODO: If by the time the transaction executes it's on a different
            //       block than the proofs were verified on, then either the proofs
            //       need to be rerun, or the hashes of the contracts which ran
            //       during the proofs need to be compared against the current
            //       contract hashes. This will prevent a poison block.
            // TODO: If the first proof and the first auth pass, but the transaction
            //       fails (including other proof failures), then charge the first
            //       authorizer
            auto         proofSystem = sharedState.getSystemContext();
            BlockContext proofBC{*proofSystem, revisionAtBlockStart};
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
            // mode. TransactionSys lets the account's auth contract know it's in a
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

template<typename Derived>
struct null_link {};

using timer_type = boost::asio::system_timer;

template<typename Derived>
using cft_consensus = basic_cft_consensus<Derived, timer_type>;

void run(const std::string& db_path,
         AccountNumber      producer,
         const std::vector<AccountNumber>& producers,
         const std::vector<std::string>& peers,
         const std::string& host,
         bool               host_perf,
         uint32_t           leeway_us,
         bool               allow_slow)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   auto sharedState =
       std::make_shared<psibase::SharedState>(SharedDatabase{db_path, allow_slow}, WasmCache{128});
   auto system = sharedState->getSystemContext();
   auto queue  = std::make_shared<transaction_queue>();

   if (!host.empty())
   {
      // TODO: command-line options
      auto http_config = std::make_shared<http::http_config>(http::http_config{
          .num_threads      = 4,
          .max_request_size = 10 * 1024 * 1024,
          .idle_timeout_ms  = std::chrono::milliseconds{4000},
          .allow_origin     = "*",
          .address          = "0.0.0.0",
          .port             = 8080,
          .host             = host,
          .host_perf        = host_perf,
      });

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

      auto server = http::server::create(http_config, sharedState);
   }

   bool showedBootMsg = false;

   // TODO: temporary loop
   // TODO: replay
   boost::asio::io_context chainContext;

   using node_type = node<null_link, direct_routing, cft_consensus, ForkDb>;
   node_type node(chainContext, system.get());
   node.set_producer_id(producer);
   node.set_producers(producers);

   auto endpoint = node.listen({boost::asio::ip::tcp::v4(), 0});
   std::cout << "listening on " << endpoint << std::endl;
   for(const std::string& peer : peers)
   {
      // TODO: handle ipv6 addresses [addr]:port
      auto pos = peer.find(':');
      if(pos == std::string::npos)
      {
         std::cout << "missing p2p port (there is not default yet): " << peer << std::endl;
         continue;
      }
      node.async_connect(peer.substr(0, pos), peer.substr(pos + 1));
   }
   
   timer_type timer(chainContext);

   // TODO: post the transactions to chainContext rather than batching them at fixed intervals.
   auto process_transactions = [&](){
      std::vector<transaction_queue::entry> entries;
      {
         std::scoped_lock lock{queue->mutex};
         std::swap(entries, queue->entries);
      }
      if(auto bc = node.chain().getBlockContext())
      {
         auto revisionAtBlockStart = node.chain().getHeadRevision();
         for (auto& entry : entries)
         {
            if (entry.is_boot)
               push_boot(*bc, entry);
            else
               pushTransaction(*sharedState, revisionAtBlockStart, *bc, entry,
                               std::chrono::microseconds(100'000),  // TODO
                               std::chrono::microseconds(100'000),  // TODO
                               std::chrono::microseconds(leeway_us));
         }

         // TODO: this should go in the leader's production loop
         if (bc->needGenesisAction)
         {
            if (!showedBootMsg)
            {
               std::cout << "Need genesis block; use 'psibase boot' to boot chain\n";
               showedBootMsg = true;
            }
            //continue;
         }
      }
      else
      {
         for (auto& entry : entries)
         {
            entry.callback("redirect to leader");
         }
      }
   };
   loop(timer, process_transactions);

   chainContext.run();
}

const char usage[] = "USAGE: psinode [OPTIONS] database";

int main(int argc, char* argv[])
{
   std::string db_path;
   std::string producer   = {};
   std::vector<std::string> prods;
   std::string host       = {};
   bool        host_perf  = false;
   uint32_t    leeway_us  = 30000;  // TODO: find a good default
   bool        allow_slow = false;
   std::vector<std::string> peers;

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   auto                    opt = desc.add_options();
   opt("database", po::value<std::string>(&db_path)->value_name("path")->required(),
       "Path to database");
   opt("producer,p", po::value<std::string>(&producer), "Name of this producer");
   opt("prods", po::value(&prods), "Names of all producers");
   opt("peer", po::value(&peers), "Peer endpoint");
   opt("host,o", po::value<std::string>(&host)->value_name("name"), "Host http server");
   opt("host-perf,O", po::bool_switch(&host_perf), "Show various hosting metrics");
   opt("leeway,l", po::value<uint32_t>(&leeway_us),
       "Transaction leeway, in us. Defaults to 30000.");
   opt("slow", po::bool_switch(&allow_slow),
       "Don't complain if unable to lock memory for database. This will still attempt to lock "
       "memory, but if it fails it will continue to run, but more slowly.");
   opt("help,h", "Show this message");

   po::positional_options_description p;
   p.add("database", 1);

   po::variables_map vm;
   po::store(po::command_line_parser(argc, argv).options(desc).positional(p).run(), vm);
   try
   {
      po::notify(vm);
   }
   catch (std::exception& e)
   {
      if (!vm.count("help"))
      {
         std::cout << e.what() << "\n";
         return 1;
      }
   }

   if (vm.count("help"))
   {
      std::cout << usage << "\n\n";
      std::cout << desc << "\n";
      return 1;
   }

   try
   {
      std::vector<AccountNumber> producers;
      for(const auto& pname : prods)
      {
         producers.push_back(AccountNumber{pname});
      }
      run(db_path, AccountNumber{producer}, producers, peers, host, host_perf, leeway_us, allow_slow);
      return 0;
   }
   catch (std::exception& e)
   {
      std::cout << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
