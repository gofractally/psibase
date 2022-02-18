#include "nc-test.hpp"
#include <newchain/tester.hpp>
#include "nc-boot.hpp"

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
                    {
                        {
                            .sender   = 9999,
                            .contract = 9999,
                            .raw_data = eosio::convert_to_bin(newchain::genesis_action_data{
                                .code = read_whole_file("nc-boot.wasm"),
                            }),
                        },
                        {
                            .sender   = 1,
                            .contract = 1,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                                .auth_contract = 2,
                                .privileged    = false,
                            }}),
                        },
                        {
                            .sender   = 1,
                            .contract = 1,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = 2,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("nc-test-cntr.wasm"),
                            }}),
                        },
                    }))))
             << "\n";

   std::cout << format_json(trim_raw_data(t.push_transaction(t.make_transaction(  //
                    {{
                        .sender   = 2,
                        .contract = 2,
                        .raw_data = eosio::convert_to_bin(payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }}))))
             << "\n";

   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "\n\n" << t.get_path() << "\n\n";
   execute("ls -lh " + t.get_path());
   std::cout << "\n\n";
}
