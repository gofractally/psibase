#define CATCH_CONFIG_MAIN
#include <base_contracts/test.hpp>

#include "test-cntr.hpp"
#include "token.hpp"

using namespace eosio;
using namespace psibase;

static constexpr account_num test_kv_contract = 3;  // TODO: fetch dynamically

TEST_CASE("t1")
{
   test_chain t;

   std::cout << "\n\n";
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "start genesis\n";
   t.start_block();
   std::cout << format_json(t.get_head_block_info()) << "\n";

   std::cout << "boot\n";
   boot_minimal(t);

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {
                        {
                            .sender   = boot::contract,
                            .contract = account::contract,
                            .raw_data =
                                eosio::convert_to_bin(account::action{account::create_account{
                                    .name          = "test-cntr",
                                    .auth_contract = "transaction.sys",
                                }}),
                        },
                        {
                            .sender   = boot::contract,
                            .contract = boot::contract,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = 3,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("test-cntr.wasm"),
                            }}),
                        },
                    }))) == "");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {{
                        .sender   = 3,
                        .contract = 3,
                        .raw_data = eosio::convert_to_bin(payload{
                            .number = 3,
                            .memo   = "Counting down",
                        }),
                    }}))) == "");

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
   boot_minimal(t);
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {
                        {
                            .sender   = boot::contract,
                            .contract = account::contract,
                            .raw_data =
                                eosio::convert_to_bin(account::action{account::create_account{
                                    .name          = "token.sys",
                                    .auth_contract = "transaction.sys",
                                }}),
                        },
                        {
                            .sender   = boot::contract,
                            .contract = boot::contract,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = token::contract,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("token.wasm"),
                            }}),
                        },
                    }))) == "");

   // Accounts 4-103
   for (int i = 0; i < 100; ++i)
      REQUIRE(                          //
          show(false,                   //
               t.push_transaction(      //
                   t.make_transaction(  //
                       {
                           {
                               .sender   = boot::contract,
                               .contract = account::contract,
                               .raw_data =
                                   eosio::convert_to_bin(account::action{account::create_account{
                                       .name          = "x" + std::to_string(i),
                                       .auth_contract = "transaction.sys",
                                   }}),
                           },
                       }))) == "");

   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
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
                     }}))) == "");

   for (int i = 0; i < 100; ++i)
      REQUIRE(                          //
          show(false,                   //
               t.push_transaction(      //
                   t.make_transaction(  //
                       {{
                           .sender   = 3,
                           .contract = token::contract,
                           .raw_data = eosio::convert_to_bin(token::action{token::transfer{
                               .to     = 4,
                               .amount = s2a("0.0001 TOK"),
                               .memo   = "3->4",
                           }}),
                       }}))) == "");

}  // t2

TEST_CASE("kv")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   REQUIRE(                          //
       show(false,                   //
            t.push_transaction(      //
                t.make_transaction(  //
                    {
                        {
                            .sender   = boot::contract,
                            .contract = account::contract,
                            .raw_data =
                                eosio::convert_to_bin(account::action{account::create_account{
                                    .name          = "test_kv.sys",
                                    .auth_contract = "transaction.sys",
                                }}),
                        },
                        {
                            .sender   = boot::contract,
                            .contract = boot::contract,
                            .raw_data = eosio::convert_to_bin(boot::action{boot::set_code{
                                .contract   = test_kv_contract,
                                .vm_type    = 0,
                                .vm_version = 0,
                                .code       = read_whole_file("test_kv.wasm"),
                            }}),
                        },
                        {
                            .sender   = test_kv_contract,
                            .contract = test_kv_contract,
                        },
                    }))) == "");
}  // kv
