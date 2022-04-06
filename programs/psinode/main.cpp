#include <contracts/system/account_sys.hpp>
#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/auth_fake_sys.hpp>
#include <contracts/system/rpc_account_sys.hpp>
#include <contracts/system/rpc_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
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

// TODO: configurable wasm locations
void bootstrap_chain(system_context& system)
{
   auto push = [&](auto& bc, AccountNumber sender, AccountNumber contract, const auto& data)
   {
      signed_transaction t;
      t.trx.expiration.seconds = bc.current.header.time.seconds + 1;
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
      t.trx.expiration.seconds = bc.current.header.time.seconds + 1;
      t.trx.actions.push_back({a});
      bc.push_transaction(t);
   };

   auto reg_rpc = [&](auto& bc, account_num contract, account_num rpc_contract)
   {
      push_action(
          bc,
          transactor<rpc_sys>(contract, rpcContractNum).register_contract(contract, rpc_contract));
   };

   auto upload = [&](auto& bc, account_num contract, const char* path, const char* contentType,
                     const char* filename)
   {
      transactor<system_contract::rpc_account_sys> rasys(contract, contract);
      push_action(bc, rasys.upload_rpc_sys(path, contentType, read_whole_file(filename)));
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
                        .contract      = rpcContractNum,
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("rpc_sys.wasm"),
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
                        .contract      = AccountNumber("roothost-sys"),
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("rpc_roothost_sys.wasm"),
                    },
                    {
                        .contract      = AccountNumber("account-rpc"),
                        .auth_contract = system_contract::auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("rpc_account_sys.wasm"),
                    },
                },
        });

   AccountNumber                            roothost_rpc("roothost-sys");
   AccountNumber                            account_rpc("account-rpc");
   transactor<system_contract::account_sys> asys(system_contract::account_sys::contract,
                                                 system_contract::account_sys::contract);
   push_action(
       bc, asys.startup(std::vector<AccountNumber>{
               system_contract::transaction_sys::contract, system_contract::account_sys::contract,
               AccountNumber("rpc"),  /// TODO: where do I get this constant?
               system_contract::auth_fake_sys::contract, system_contract::auth_ec_sys::contract,
               system_contract::verify_ec_sys::contract, roothost_rpc, account_rpc
               //{20, "rpc.roothost.sys"},
               //{21, "rpc.account.sys"},
           }));

   reg_rpc(bc, roothost_rpc, roothost_rpc);
   upload(bc, roothost_rpc, "/", "text/html", "../contracts/user/rpc_roothost_sys/ui/index.html");
   upload(bc, roothost_rpc, "/ui/index.js", "text/javascript",
          "../contracts/user/rpc_roothost_sys/ui/index.js");

   reg_rpc(bc, system_contract::account_sys::contract, account_rpc);
   upload(bc, account_rpc, "/", "text/html", "../contracts/system/rpc_account_sys/ui/index.html");
   upload(bc, account_rpc, "/ui/index.js", "text/html",
          "../contracts/system/rpc_account_sys/ui/index.js");

   push_action(bc, asys.newAccount(AccountNumber("alice"),
                                   system_contract::transaction_sys::contract, false));
   push_action(bc, asys.newAccount(AccountNumber("bob"), system_contract::transaction_sys::contract,
                                   false));

   bc.commit();
}

struct transaction_queue
{
   struct entry
   {
      std::vector<char>               packed_signed_trx;
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
          .max_request_size = 1024,
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
         http_config->push_transaction_async =
             [queue](std::vector<char> packed_signed_trx, http::push_transaction_callback callback)
         {
            std::scoped_lock lock{queue->mutex};
            queue->entries.push_back({std::move(packed_signed_trx), std::move(callback)});
         };

      auto server = http::server::create(http_config, shared_state);
   }

   if (bootstrap)
      bootstrap_chain(*system);

   // TODO: temporary loop
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

         // TODO: block limits
         for (auto& entry : entries)
            push_transaction(bc, entry);

         bc.commit();
         std::cout << psio::convert_to_json((BlockHeader&)bc.current) << "\n";
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
