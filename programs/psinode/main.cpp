#include <newchain/http.hpp>
#include <newchain/transaction_context.hpp>

#include <eosio/finally.hpp>
#include <iostream>
#include <thread>

using namespace newchain;

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

// TODO: configurable locations
void bootstrap_chain(system_context& system)
{
   auto push = [&](auto& bc, account_num sender, account_num contract, const auto& data) {
      signed_transaction t;
      t.expiration = bc.current.time + 1;
      t.actions.push_back({
          .sender   = sender,
          .contract = contract,
          .raw_data = eosio::convert_to_bin(data),
      });
      bc.push_transaction(t);
   };

   block_context bc{system, true};
   bc.start();
   eosio::check(bc.is_genesis_block, "can not bootstrap non-empty chain");
   push(bc, 0, 0, genesis_action_data{.code = read_whole_file("nc-boot.wasm")});
   bc.commit();
}

void run(const char* db_path, bool bootstrap, bool produce, bool api_server)
{
   // TODO: configurable wasm_cache size
   auto db           = std::make_unique<database>(db_path);
   auto shared_state = std::make_shared<newchain::shared_state>(std::move(db), wasm_cache{128});
   auto system       = shared_state->get_system_context();

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

   if (bootstrap)
      bootstrap_chain(*system);

   // TODO: temporary loop
   while (true)
   {
      std::this_thread::sleep_for(std::chrono::milliseconds{1000});
      if (produce)
      {
         block_context bc{*system, true};
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
