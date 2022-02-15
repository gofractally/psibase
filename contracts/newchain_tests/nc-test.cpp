#include <eosio/tester.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace eosio;

TEST_CASE("t1")
{
   test_chain t;
   t.start_block();
   t.start_block();
   t.start_block();

   std::cout << "\n\n" << t.get_path() << "\n\n";
   eosio::execute("ls -lh " + t.get_path());
   std::cout << "\n\n";
}
