#include <psibase/TransactionContext.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/http.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

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

void run(const char* db_path, bool produce, const char* host, bool host_perf, uint32_t leeway_us)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   auto sharedState =
       std::make_shared<psibase::SharedState>(SharedDatabase{db_path}, WasmCache{128});
   auto system = sharedState->getSystemContext();
   auto queue  = std::make_shared<transaction_queue>();

   if (host)
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

const char usage[] = "USAGE: psinode [OPTIONS] database\n";
const char help[]  = R"(
OPTIONS:
      -p, --produce
            Produce blocks

      -o, --host <name>
            Host http server

      -O, --host-perf
            Show various metrics

      -l, --leeway <amount>
            Transaction leeway, in us. Defaults to 30000.

      -h, --help
            Show this message
)";

// TODO: use a command-line parser
int main(int argc, char* argv[])
{
   bool        show_usage = false;
   bool        error      = false;
   bool        produce    = false;
   const char* host       = nullptr;
   bool        host_perf  = false;
   uint32_t    leeway_us  = 30000;  // TODO: find a good default
   int         next_arg   = 1;
   while (next_arg < argc && argv[next_arg][0] == '-')
   {
      if (!strcmp(argv[next_arg], "-h") || !strcmp(argv[next_arg], "--help"))
         show_usage = true;
      else if (!strcmp(argv[next_arg], "-p") || !strcmp(argv[next_arg], "--produce"))
         produce = true;
      else if ((!strcmp(argv[next_arg], "-o") || !strcmp(argv[next_arg], "--host")) &&
               next_arg + 1 < argc)
         host = argv[++next_arg];
      else if (!strcmp(argv[next_arg], "-O") || !strcmp(argv[next_arg], "--host-perf"))
         host_perf = true;
      else if ((!strcmp(argv[next_arg], "-l") || !strcmp(argv[next_arg], "--leeway")) &&
               next_arg + 1 < argc)
         leeway_us = std::stoi(argv[++next_arg]);
      else
      {
         std::cerr << "unknown option: " << argv[next_arg] << "\n";
         error = true;
      }
      ++next_arg;
   }
   if (next_arg != argc - 1)
      error = true;
   if (show_usage || error)
   {
      std::cerr << usage;
      if (show_usage)
         std::cerr << help;
      return error;
   }
   try
   {
      run(argv[next_arg], produce, host, host_perf, leeway_us);
      return 0;
   }
   catch (std::exception& e)
   {
      std::cerr << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
