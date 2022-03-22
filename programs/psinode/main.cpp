#include <base_contracts/account_sys.hpp>
#include <base_contracts/auth_ec_sys.hpp>
#include <base_contracts/auth_fake_sys.hpp>
#include <base_contracts/transaction_sys.hpp>
#include <base_contracts/verify_ec_sys.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/http.hpp>
#include <psibase/transaction_context.hpp>

#include <eosio/finally.hpp>
#include <iostream>
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
   auto push = [&](auto& bc, account_num sender, account_num contract, const auto& data) {
      signed_transaction t;
      t.trx.expiration = bc.current.time + 1;
      t.trx.actions.push_back({
          .sender   = sender,
          .contract = contract,
          .raw_data = eosio::convert_to_bin(data),
      });
      bc.push_transaction(t);
   };
   auto push_action = [&](auto& bc, action a ) {
      signed_transaction t;
      t.trx.expiration = bc.current.time + 1;
      t.trx.actions.push_back({a});
      bc.push_transaction(t);
   };


   block_context bc{system, true, true};
   bc.start();
   eosio::check(bc.is_genesis_block, "can not bootstrap non-empty chain");
   push(bc, 0, 0,
        genesis_action_data{
            .contracts =
                {
                    {
                        .contract      = transaction_sys::contract,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = transaction_sys::contract_flags,
                        .code          = read_whole_file("transaction_sys.wasm"),
                    },
                    {
                        .contract      = account_sys::contract,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = account_sys::contract_flags,
                        .code          = read_whole_file("account_sys.wasm"),
                    },
                    {
                        .contract      = rpc_contract_num,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("rpc.wasm"),
                    },
                    {
                        .contract      = auth_fake_sys::contract,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_fake_sys.wasm"),
                    },
                    {
                        .contract      = auth_ec_sys::contract,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("auth_ec_sys.wasm"),
                    },
                    {
                        .contract      = verify_ec_sys::contract,
                        .auth_contract = auth_fake_sys::contract,
                        .flags         = 0,
                        .code          = read_whole_file("verify_ec_sys.wasm"),
                    },
                },
        });

   transactor<account_sys> asys( account_sys::contract, account_sys::contract );
   push_action(bc, asys.startup(  100,  // TODO: keep space reserved?
            vector<account_name> {
                    {transaction_sys::contract, "transaction.sys"},
                    {account_sys::contract, "account.sys"},
                    {auth_fake_sys::contract, "auth_fake.sys"},
                    {auth_ec_sys::contract, "auth_ec.sys"},
                    {verify_ec_sys::contract, "verify_ec.sys"},
                } ) );

   push_action(bc, asys.create_account( "alice", "transaction.sys", false ) );
   push_action(bc, asys.create_account( "bob", "transaction.sys", false ) );

   bc.commit();
}

void run(const char* db_path, bool bootstrap, bool produce, bool api_server)
{
   execution_context::register_host_functions();

   // TODO: configurable wasm_cache size
   auto shared_state =
       std::make_shared<psibase::shared_state>(shared_database{db_path}, wasm_cache{128});
   auto system = shared_state->get_system_context();

   if (api_server)
   {
      // TODO: config file
      auto http_config = std::make_shared<http::http_config>(http::http_config{
          .num_threads      = 4,
          .max_request_size = 1024,
          .idle_timeout_ms  = std::chrono::milliseconds{1000},
          .allow_origin     = "*",
          .static_dir       = "",
          .address          = "0.0.0.0",
          .port             = "8080",
          .unix_path        = "",
      });
      auto server      = http::server::create(http_config, shared_state);
   }

   if (bootstrap)
      bootstrap_chain(*system);

   // TODO: temporary loop
   while (true)
   {
      std::this_thread::sleep_for(std::chrono::milliseconds{1000});
      if (produce)
      {
         block_context bc{*system, true, true};
         bc.start();
         bc.commit();
         std::cout << eosio::convert_to_json((block_header&)bc.current) << "\n";
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

      -a, --api-server
            Enable API server

      -h, --help
            Show this message
)";

// TODO: use a command-line parser
int main(int argc, char* argv[])
{
   bool show_usage = false;
   bool error      = false;
   bool bootstrap  = false;
   bool produce    = false;
   bool api_server = false;
   int  next_arg   = 1;
   while (next_arg < argc && argv[next_arg][0] == '-')
   {
      if (!strcmp(argv[next_arg], "-h") || !strcmp(argv[next_arg], "--help"))
         show_usage = true;
      else if (!strcmp(argv[next_arg], "-b") || !strcmp(argv[next_arg], "--bootstrap"))
         bootstrap = true;
      else if (!strcmp(argv[next_arg], "-p") || !strcmp(argv[next_arg], "--produce"))
         produce = true;
      else if (!strcmp(argv[next_arg], "-a") || !strcmp(argv[next_arg], "--api-server"))
         api_server = true;
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
      run(argv[next_arg], bootstrap, produce, api_server);
      return 0;
   }
   catch (std::exception& e)
   {
      std::cerr << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
