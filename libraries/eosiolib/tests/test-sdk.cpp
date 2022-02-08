#include <eosio/tester.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

#include <bios/bios.hpp>
#include <eosio/from_json.hpp>
#include <eosio/to_json.hpp>
#include "contracts/get-code.hpp"

using namespace eosio;

static void run_nodeos(test_chain& chain)
{
   chain.finish_block();
   chain.finish_block();

   eosio::execute("rm -rf example_chain");
   eosio::execute("mkdir -p example_chain/blocks");
   eosio::execute("cp " + chain.get_path() + "/blocks/blocks.log example_chain/blocks");

   eosio::execute(
       "./clsdk/bin/nodeos -d example_chain "
       "--config-dir example_config "
       "--plugin eosio::chain_api_plugin "
       "--access-control-allow-origin \"*\" "
       "--access-control-allow-header \"*\" "
       "--http-validate-host 0 "
       "--http-server-address 0.0.0.0:8888 "
       "--contracts-console "
       "-e -p eosio");
}

TEST_CASE("get_code")
{
   test_chain chain;
   chain.set_code("eosio"_n, "clsdk/contracts/bios.wasm");
   bios::activate(chain, {
                             eosio::feature::action_return_value,
                             eosio::feature::get_code_hash,
                         });
   chain.create_code_account("getcode"_n);
   chain.set_code("getcode"_n, "test-contracts/get-code.wasm");
   chain.set_abi("getcode"_n, "test-contracts/get-code.abi");
   chain.as("getcode"_n).act<get_code::actions::print>("alice"_n);
   chain.as("getcode"_n).act<get_code::actions::print>("eosio"_n);
   chain.as("getcode"_n).act<get_code::actions::print>("getcode"_n);
   chain.as("getcode"_n).act<get_code::actions::shouldhave>("eosio"_n);
   chain.as("getcode"_n).act<get_code::actions::shouldhave>("getcode"_n);
   chain.as("getcode"_n).act<get_code::actions::shouldnot>("alice"_n);

   auto result = chain.as("getcode"_n).act<get_code::actions::get>("getcode"_n);
   std::cout << "\naction returned: " << eosio::format_json(result) << "\n";
   CHECK(result.struct_version.value == 0);
   CHECK(result.code_sequence == 1);
   CHECK(result.hash != eosio::checksum256{});
   CHECK(result.vm_type == 0);
   CHECK(result.vm_version == 0);

   // run_nodeos(chain);

   // clsdk/bin/cleos push action getcode get '["eosio"]' -p getcode -j | jq .processed.action_traces[0].return_value_data
}

template <typename T>
void convert_container(T& dest, const T& src)
{
   dest = src;
}

void convert_container(eosio::input_stream& dest, const eosio::bytes& src)
{
   dest = {src.data.data(), src.data.size()};
}

TEST_CASE("hex_serialization")
{
   auto test1 = [](auto* from_json_t, auto* to_json_t, std::string_view hex) {
      std::string input_json = "\"" + (std::string)hex + "\"";
      auto copy = input_json;
      remove_cvref_t<decltype(*from_json_t)> from_json_obj;
      json_token_stream input_stream(copy.data());
      from_json(from_json_obj, input_stream);

      remove_cvref_t<decltype(*to_json_t)> to_json_obj;
      convert_container(to_json_obj, from_json_obj);
      auto output_json = convert_to_json(to_json_obj);
      CHECK(input_json == output_json);
   };

   auto test2 = [&](auto* from_json_t, auto* to_json_t) {
      test1(from_json_t, to_json_t, "");
      test1(from_json_t, to_json_t, "00");
      test1(from_json_t, to_json_t, "FF80AA0012");
   };

   test2((eosio::bytes*)nullptr, (eosio::bytes*)nullptr);
   test2((eosio::bytes*)nullptr, (eosio::input_stream*)nullptr);
   test2((std::vector<char>*)nullptr, (std::vector<char>*)nullptr);
   test2((std::vector<signed char>*)nullptr, (std::vector<signed char>*)nullptr);
   test2((std::vector<unsigned char>*)nullptr, (std::vector<unsigned char>*)nullptr);
}
