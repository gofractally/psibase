#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <iostream>
#include <psio/graphql.hpp>
#include <psio/graphql_connection.hpp>

struct InputArg
{
   std::string one;
   std::string two;
};
PSIO_REFLECT(InputArg, method(one), method(two))

struct Account
{
   std::string firstName;
   std::string lastName;
};
PSIO_REFLECT(Account, firstName, lastName)
using ChainAccountConnection = psio::Connection<Account, "AccountConnection", "AccountEdge">;

struct Root
{
   std::string world;
   int         hello;
   int64_t     sum(int a, int b) const { return a + b; }
   std::string cat(InputArg arg) const { return arg.one + arg.two; }

   ChainAccountConnection getAccounts(std::optional<int>         first,
                                      std::optional<std::string> before,
                                      std::optional<int>         last,
                                      std::optional<std::string> after) const
   {
      return psio::makeConnection<ChainAccountConnection, std::string>(
          {}, {}, {}, {}, first, last, before, after, accounts.begin(), accounts.end(),
          [](auto& it) { ++it; }, [](auto& it) { --it; }, [](auto e) { return e->firstName; },
          [](auto e) { return *e; },
          [this](auto key)
          {
             return std::lower_bound(accounts.begin(), accounts.end(), Account{key},
                                     [](auto a, auto b) { return a.firstName < b.firstName; });
          },
          [this](auto key)
          {
             return std::upper_bound(accounts.begin(), accounts.end(), Account{key},
                                     [](auto a, auto b) { return a.firstName < b.firstName; });
          });
   }

   std::vector<Account> accounts;
};

PSIO_REFLECT(Root,
             method(world),
             method(hello),
             method(sum, a, b),
             method(cat, arg),
             method(getAccounts, first, before, last, after))

TEST_CASE("graphql")
{
   Root r{"hello", 42};

   std::cout << psio::gql_query(r, "{ hello, world, mysum: sum( a: 1, b: 2)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(r, "{ hello, world, sum( a: 1)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(
       r, "{ hello, world, cat( arg: { two: \"hello\", one: \"world\"} )  }", "");

   r.accounts = std::vector<Account>{{"dan", "larimer"}, {"anna", "taylor"}, {"pam", "larimer"}};
   std::sort(r.accounts.begin(), r.accounts.end(),
             [](auto a, auto b) { return a.firstName < b.firstName; });

   std::cout << "\n";
   std::cout << psio::gql_query(
       r, "{ accounts:getAccounts( first: 2 ) { edges { node {firstName, lastName } } }  }", "");

   std::cout << "\n";
   std::cout << psio::gql_query(
       r,
       "{ accounts:getAccounts( last: 2 ) { pageInfo { hasPreviousPage, hasNextPage }, "
       "edges { node {firstName, lastName } } }  }",
       "");
}
