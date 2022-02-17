#include <newchain/tester.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace eosio;
using namespace newchain;

TEST_CASE("t1")
{
   test_chain t;

   std::cout << "\n\n";
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "start genesis\n";
   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "set first code\n";
   std::cout << format_json(trim_raw_data(t.push_transaction(t.make_transaction(  //
                    {{
                        .sender   = 9999,
                        .contract = 9999,
                        .act      = 9999,
                        .raw_data = eosio::convert_to_bin(newchain::genesis_action_data{
                            .code = read_whole_file("nc-test-cntr.wasm"),
                        }),
                    }}))))
             << "\n";

   std::cout << format_json(trim_raw_data(t.push_transaction(t.make_transaction(  //
                    {{
                        .sender   = 1,
                        .contract = 1,
                        .act      = 999,
                        .raw_data = {},
                    }}))))
             << "\n";

   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "\n\n" << t.get_path() << "\n\n";
   execute("ls -lh " + t.get_path());
   std::cout << "\n\n";
}
