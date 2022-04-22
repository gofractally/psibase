#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/http.hpp>
#include <psibase/transaction_context.hpp>
#include <psio/to_json.hpp>

#include <eosio/finally.hpp>
#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;

std::vector<char> read_whole_file(const char* filename)
{
   FILE* f = fopen(filename, "r");
   if (!f)
      throw std::runtime_error("error reading file " + std::string(filename));
   eosio::finally fin{[&] { fclose(f); }};

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

// TODO: remove; now lives in rust/psibase
void bootstrap_chain(system_context& system)
{
   auto push = [&](auto& bc, AccountNumber sender, AccountNumber contract, const auto& data)
   {
      signed_transaction t;
      t.trx.tapos.expiration.seconds = bc.current.header.time.seconds + 1;
      t.trx.actions.push_back({
          .sender   = sender,
          .contract = contract,
          .raw_data = psio::convert_to_frac(data),
      });
      bc.push_transaction(t);
   };

   auto push_action = [&](auto& bc, action a)
   {
      signed_transaction t;
      t.trx.tapos.expiration.seconds = bc.current.header.time.seconds + 1;
      t.trx.actions.push_back({a});
      bc.push_transaction(t);
   };

   auto reg_rpc = [&](auto& bc, account_num contract, account_num rpc_contract)
   {
      push_action(
          bc,
          transactor<proxy_sys>(contract, proxyContractNum).registerServer(contract, rpc_contract));
   };

   auto upload = [&](auto& bc, account_num contract, const char* path, const char* contentType,
                     const char* filename)
   {
      transactor<system_contract::rpc_account_sys> rasys(contract, contract);
      push_action(bc, rasys.uploadSys(path, contentType, read_whole_file(filename)));
   };

   block_context bc{system, true, true};
   bc.start();
   eosio::check(bc.is_genesis_block, "can not bootstrap non-empty chain");
   push(bc, AccountNumber(), AccountNumber(),
        genesis_action_data{
            .contracts =
                {
                    {
                        .contract      = system_contract::transaction_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = system_contract::transaction_sys::contract_flags,
                        .code          = read_whole_file("transaction_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::account_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = system_contract::account_sys::contract_flags,
                        .code          = read_whole_file("account_sys.wasm"),
                    },
                    {
                        .contract      = proxyContractNum,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("proxy_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::auth_fake_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_fake_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::auth_ec_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_ec_sys.wasm"),
                    },
                    {
                        .contract      = system_contract::verify_ec_sys::contract,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("verify_ec_sys.wasm"),
                    },
                    {
                        .contract      = AccountNumber("common-sys"),
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("common_sys.wasm"),
                    },
                    {
                        .contract      = AccountNumber("account-rpc"),  // TODO: need -sys suffix
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("rpc_account_sys.wasm"),
                    },
                    {
                        .contract      = AccountNumber("explore-sys"),
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("explore_sys.wasm"),
                    },
                },
        });

   AccountNumber                            common_sys("common-sys");
   AccountNumber                            account_rpc("account-rpc");
   transactor<system_contract::account_sys> asys(system_contract::account_sys::contract,
                                                 system_contract::account_sys::contract);
   push_action(bc, asys.startup(std::vector<AccountNumber>{
                       system_contract::transaction_sys::contract,
                       system_contract::account_sys::contract,
                       proxyContractNum,
                       system_contract::auth_fake_sys::contract,
                       system_contract::auth_ec_sys::contract,
                       system_contract::verify_ec_sys::contract,
                       AccountNumber("common-sys"),
                       AccountNumber("account-rpc"),
                   }));

   reg_rpc(bc, common_sys, common_sys);
   upload(bc, common_sys, "/", "text/html", "../contracts/user/common_sys/ui/index.html");
   upload(bc, common_sys, "/common/rpc.mjs", "text/javascript",
          "../contracts/user/common_sys/common/rpc.mjs");
   upload(bc, common_sys, "/common/useGraphQLQuery.mjs", "text/javascript",
          "../contracts/user/common_sys/common/useGraphQLQuery.mjs");
   upload(bc, common_sys, "/ui/index.js", "text/javascript",
          "../contracts/user/common_sys/ui/index.js");

   reg_rpc(bc, system_contract::account_sys::contract, account_rpc);
   upload(bc, account_rpc, "/", "text/html", "../contracts/system/rpc_account_sys/ui/index.html");
   upload(bc, account_rpc, "/ui/index.js", "text/javascript",
          "../contracts/system/rpc_account_sys/ui/index.js");

   reg_rpc(bc, "explore-sys"_a, "explore-sys"_a);
   upload(bc, "explore-sys"_a, "/", "text/html", "../contracts/user/explore_sys/ui/index.html");
   upload(bc, "explore-sys"_a, "/ui/index.js", "text/javascript",
          "../contracts/user/explore_sys/ui/index.js");

   bc.commit();
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

bool push_boot(block_context& bc, transaction_queue::entry& entry)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto transactions =
          psio::convert_from_frac<std::vector<signed_transaction>>(entry.packed_signed_trx);
      transaction_trace trace;

      try
      {
         if (!bc.need_genesis_action)
         {
            trace.error = "chain is already booted";
         }
         else
         {
            for (auto& trx : transactions)
            {
               trace = {};
               bc.push_transaction(trx, trace);
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

void push_transaction(block_context& bc, transaction_queue::entry& entry)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto              trx = psio::convert_from_frac<signed_transaction>(entry.packed_signed_trx);
      transaction_trace trace;

      try
      {
         if (bc.need_genesis_action)
            trace.error = "Need genesis block; use 'psibase boot' to boot chain";
         else
            bc.push_transaction(trx, trace);
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
}  // push_transaction

void run(const char* db_path, bool bootstrap, bool produce, const char* host)
{
   execution_context::register_host_functions();

   // TODO: configurable wasm_cache size
   auto shared_state =
       std::make_shared<psibase::shared_state>(shared_database{db_path}, wasm_cache{128});
   auto system = shared_state->get_system_context();
   auto queue  = std::make_shared<transaction_queue>();

   if (host)
   {
      // TODO: config file
      auto http_config = std::make_shared<http::http_config>(http::http_config{
          .num_threads      = 4,
          .max_request_size = 10 * 1024 * 1024,
          .idle_timeout_ms  = std::chrono::milliseconds{1000},
          .allow_origin     = "*",
          .static_dir       = "",
          .address          = "0.0.0.0",
          .port             = 8080,
          .unix_path        = "",
          .host             = host,
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

      auto server = http::server::create(http_config, shared_state);
   }

   if (bootstrap)
      bootstrap_chain(*system);

   bool showedBootMsg = false;

   // TODO: temporary loop
   // TODO: replay
   while (true)
   {
      std::this_thread::sleep_for(std::chrono::milliseconds{1000});
      if (produce)
      {
         std::vector<transaction_queue::entry> entries;
         {
            std::scoped_lock lock{queue->mutex};
            std::swap(entries, queue->entries);
         }

         block_context bc{*system, true, true};
         bc.start();

         bool abort_boot = false;
         for (auto& entry : entries)
         {
            if (entry.is_boot)
               abort_boot = !push_boot(bc, entry);
            else
               push_transaction(bc, entry);
         }
         if (abort_boot)
            continue;

         if (bc.need_genesis_action)
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
      -b, --bootstrap
            Bootstrap new chain

      -p, --produce
            Produce blocks

      -o, --host <name>
            Enable API server

      -h, --help
            Show this message
)";

// TODO: use a command-line parser
int main(int argc, char* argv[])
{
   bool        show_usage = false;
   bool        error      = false;
   bool        bootstrap  = false;
   bool        produce    = false;
   const char* host       = nullptr;
   int         next_arg   = 1;
   while (next_arg < argc && argv[next_arg][0] == '-')
   {
      if (!strcmp(argv[next_arg], "-h") || !strcmp(argv[next_arg], "--help"))
         show_usage = true;
      else if (!strcmp(argv[next_arg], "-b") || !strcmp(argv[next_arg], "--bootstrap"))
         bootstrap = true;
      else if (!strcmp(argv[next_arg], "-p") || !strcmp(argv[next_arg], "--produce"))
         produce = true;
      else if ((!strcmp(argv[next_arg], "-o") || !strcmp(argv[next_arg], "--host")) &&
               next_arg + 1 < argc)
         host = argv[++next_arg];
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
      run(argv[next_arg], bootstrap, produce, host);
      return 0;
   }
   catch (std::exception& e)
   {
      std::cerr << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
