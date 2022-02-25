#include "nc-test.hpp"
#include <newchain/tester.hpp>
#include "nc-boot.hpp"
#include "nc-token.hpp"

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace eosio;
using namespace newchain;

void show(bool include, transaction_trace t)
{
   if (include || t.error)
      std::cout << format_json(trim_raw_data(t)) << "\n";
   check(!t.error, *t.error);
}

TEST_CASE("t1")
{
   test_chain t;

   std::cout << "\n\n";
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "start genesis\n";
   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "set first code\n";
   show(false, t.push_transaction(t.make_transaction(  //
                   {{
                       .sender   = 9999,
                       .contract = 9999,
                       .raw_data = eosio::convert_to_bin(newchain::genesis_action_data{
                           .code = read_whole_file("nc-boot.wasm"),
                       }),
                   }})));

   show(false, t.push_transaction(t.make_transaction(  //
                   {
                       {
                           .sender   = boot::contract,
                           .contract = boot::contract,
                           .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                               .auth_contract = 2,
                               .privileged    = false,
                           }}),
                       },
                       {
                           .sender   = boot::contract,
                           .contract = boot::contract,
                           .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                               .contract   = 2,
                               .vm_type    = 0,
                               .vm_version = 0,
                               .code       = read_whole_file("nc-test-cntr.wasm"),
                           }}),
                       },
                   })));

   show(false, t.push_transaction(t.make_transaction(  //
                   {{
                       .sender   = 2,
                       .contract = 2,
                       .raw_data = eosio::convert_to_bin(payload{
                           .number = 3,
                           .memo   = "Counting down",
                       }),
                   }})));

   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "\n\n" << t.get_path() << "\n\n";
   execute("ls -lh " + t.get_path());
   std::cout << "\n\n";
}  // t1

TEST_CASE("t2")
{
   test_chain t;
   t.start_block();
   show(false, t.push_transaction(t.make_transaction(  //
                   {{
                       .sender   = 9999,
                       .contract = 9999,
                       .raw_data = eosio::convert_to_bin(newchain::genesis_action_data{
                           .code = read_whole_file("nc-boot.wasm"),
                       }),
                   }})));

   show(false, t.push_transaction(t.make_transaction(  //
                   {
                       {
                           .sender   = boot::contract,
                           .contract = boot::contract,
                           .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                               .auth_contract = boot::contract,
                               .privileged    = false,
                           }}),
                       },
                       {
                           .sender   = boot::contract,
                           .contract = boot::contract,
                           .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                               .contract   = 2,
                               .vm_type    = 0,
                               .vm_version = 0,
                               .code       = read_whole_file("nc-token.wasm"),
                           }}),
                       },
                   })));

   // Accounts 3-102
   for (int i = 0; i < 100; ++i)
      show(false, t.push_transaction(t.make_transaction(  //
                      {{
                          .sender   = boot::contract,
                          .contract = boot::contract,
                          .raw_data = eosio::convert_to_bin(boot::action{boot::create_account{
                              .auth_contract = 1,
                              .privileged    = false,
                          }}),
                      }})));

   show(false, t.push_transaction(t.make_transaction(  //
                   {{
                        .sender   = token::contract,
                        .contract = token::contract,
                        .raw_data = eosio::convert_to_bin(token::action{token::issue{
                            .to     = 3,
                            .amount = s2a("1.0000 TOK"),
                            .memo   = "issuing",
                        }}),
                    },
                    {
                        .sender   = 3,
                        .contract = token::contract,
                        .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                            .to     = 4,
                            .amount = s2a("0.1000 TOK"),
                            .memo   = "3->4",
                        }}),
                    }})));

   for (int i = 0; i < 100; ++i)
      show(false, t.push_transaction(t.make_transaction(  //
                      {{
                          .sender   = 3,
                          .contract = token::contract,
                          .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                              .to     = 4,
                              .amount = s2a("0.0001 TOK"),
                              .memo   = "3->4",
                          }}),
                      }})));

}  // t2
