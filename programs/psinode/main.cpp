#include <psibase/TransactionContext.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/http.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;

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

void pushTransaction(BlockContext&             bc,
                     transaction_queue::entry& entry,
                     std::chrono::microseconds initialWatchdogLimit)
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
            bc.pushTransaction(trx, trace, initialWatchdogLimit);
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

void run(const std::string& db_path,
         bool               produce,
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
      if (produce)
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
   while (true)
   {
      std::this_thread::sleep_for(std::chrono::milliseconds{100});
      if (produce)
      {
         TimePointSec t{(uint32_t)time(nullptr)};
         {
            Database db{system->sharedDatabase};
            auto     session = db.startRead();
            auto     status  = db.kvGet<StatusRow>(StatusRow::db, statusKey());
            if (status && status->head && status->head->header.time >= t)
               continue;
         }

         std::vector<transaction_queue::entry> entries;
         {
            std::scoped_lock lock{queue->mutex};
            std::swap(entries, queue->entries);
         }

         BlockContext bc{*system, true, true};
         bc.start(t);
         bc.callStartBlock();

         bool abort_boot = false;
         for (auto& entry : entries)
         {
            if (entry.is_boot)
               abort_boot = !push_boot(bc, entry);
            else
               pushTransaction(bc, entry, std::chrono::microseconds(leeway_us));
         }
         if (abort_boot)
            continue;

         if (bc.needGenesisAction)
         {
            if (!showedBootMsg)
            {
               std::cout << "Need genesis block; use 'psibase boot' to boot chain\n";
               showedBootMsg = true;
            }
            continue;
         }
         bc.commit();
         std::cout << psio::convert_to_json(bc.current.header) << "\n";
      }
   }
}

const char usage[] = "USAGE: psinode [OPTIONS] database";

// TODO: use a command-line parser
int main(int argc, char* argv[])
{
   std::string db_path;
   bool        produce    = false;
   std::string host       = {};
   bool        host_perf  = false;
   uint32_t    leeway_us  = 30000;  // TODO: find a good default
   bool        allow_slow = false;

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   auto                    opt = desc.add_options();
   opt("database", po::value<std::string>(&db_path)->value_name("path")->required(),
       "Path to database");
   opt("produce,p", po::bool_switch(&produce), "Produce blocks");
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
      run(db_path, produce, host, host_perf, leeway_us, allow_slow);
      return 0;
   }
   catch (std::exception& e)
   {
      std::cout << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
