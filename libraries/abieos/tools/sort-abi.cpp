#include <eosio/abi.hpp>
#include <eosio/from_json.hpp>
#include <eosio/to_json.hpp>
#include <iostream>

int main(int argc, const char** argv)
{
   if (argc != 1)
   {
      fprintf(stderr, "usage: sort-abi <infile >outfile\n");
      fprintf(stderr, "\n");
      fprintf(stderr, "This sorts abi files for easier comparison\n");
      return 2;
   }

   try
   {
      std::string json;
      std::getline(std::cin, json, '\0');

      eosio::abi_def abi;
      eosio::json_token_stream is{json.data()};
      from_json(abi, is);

      auto sort_by_name = [](auto& v) {
         return std::sort(v.begin(), v.end(), [&](auto& a, auto& b) { return a.name < b.name; });
      };

      std::sort(abi.types.begin(), abi.types.end(),
                [&](auto& a, auto& b) { return a.new_type_name < b.new_type_name; });
      sort_by_name(abi.structs);
      sort_by_name(abi.actions);
      sort_by_name(abi.tables);
      std::sort(abi.ricardian_clauses.begin(), abi.ricardian_clauses.end(),
                [&](auto& a, auto& b) { return a.id < b.id; });
      std::sort(abi.error_messages.begin(), abi.error_messages.end(),
                [&](auto& a, auto& b) { return a.error_code < b.error_code; });
      sort_by_name(abi.variants.value);
      sort_by_name(abi.action_results.value);

      printf("%s\n", eosio::format_json(abi).c_str());

      return 0;
   }
   catch (const std::exception& e)
   {
      fprintf(stderr, "error: %s\n", e.what());
      return 1;
   }
}  // main
