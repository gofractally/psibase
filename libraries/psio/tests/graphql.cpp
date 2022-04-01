#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <iostream>
#include <psio/graphql.hpp>

struct InputArg
{
   std::string one;
   std::string two;
};
PSIO_REFLECT_INTERFACE(InputArg, (one, 0), (two, 1))
struct Root
{
   std::string world;
   int         hello;
   int64_t     sum(int a, int b) const { return a + b; }
   std::string cat(InputArg arg) const { return arg.one + arg.two; }
};

PSIO_REFLECT_INTERFACE(Root, (world, 0), (hello, 1), (sum, 2, a, b), (cat, 3, arg))

TEST_CASE("graphql")
{
   Root r{"hello", 42};

   std::cout << psio::gql_query(r, "{ hello, world, mysum: sum( a: 1, b: 2)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(r, "{ hello, world, sum( a: 1)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(
       r, "{ hello, world, cat( arg: { two: \"hello\", one: \"world\"} )  }", "");
}
