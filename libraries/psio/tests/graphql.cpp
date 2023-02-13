#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <iostream>
#include <psio/from_bin.hpp>
#include <psio/graphql.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_hex.hpp>

// These are no longer part of psio. Moved here to support the tests.
// Reason: makeConnection didn't end up as general as I hoped;
// e.g. it didn't efficiently support psibase's TableIndex.
// The version which does efficiently support TableIndex uses methods
// on TableIndex which are specific to its wrapping approach of the KV model.
namespace psio
{
   struct PageInfo
   {
      bool        hasPreviousPage = false;
      bool        hasNextPage     = false;
      std::string startCursor;
      std::string endCursor;
   };
   PSIO_REFLECT(PageInfo, hasPreviousPage, hasNextPage, startCursor, endCursor)

   template <typename Node, FixedString EdgeName>
   struct Edge
   {
      Node        node;
      std::string cursor;
      PSIO_REFLECT(Edge, node, cursor)
   };

   template <typename Node, FixedString EdgeName>
   constexpr const char* get_type_name(const Edge<Node, EdgeName>*)
   {
      return EdgeName.c_str();
   }

   template <typename Node, FixedString ConnectionName, FixedString EdgeName>
   struct Connection
   {
      using NodeType = Node;
      using Edge     = psio::Edge<Node, EdgeName>;

      std::vector<Edge> edges;
      PageInfo          pageInfo;
      PSIO_REFLECT(Connection, edges, pageInfo)
   };

   template <typename Node, FixedString ConnectionName, FixedString EdgeName>
   constexpr const char* get_type_name(const Connection<Node, ConnectionName, EdgeName>*)
   {
      return ConnectionName.c_str();
   }

   // To enable cursors to function correctly, container must not have duplicate keys
   template <typename Connection,
             typename Key,
             typename Iter,
             typename Incr_Iter,
             typename Decr_Iter,
             typename Iter_to_key,
             typename Iter_to_node,
             typename Lower_bound,
             typename Upper_bound>
   Connection makeConnection(const std::optional<Key>&         gt,
                             const std::optional<Key>&         ge,
                             const std::optional<Key>&         lt,
                             const std::optional<Key>&         le,
                             std::optional<uint32_t>           first,
                             std::optional<uint32_t>           last,
                             const std::optional<std::string>& before,
                             const std::optional<std::string>& after,
                             const Iter&                       containerBegin,
                             const Iter&                       containerEnd,
                             Incr_Iter                         incrIter,
                             Decr_Iter                         decrIter,
                             Iter_to_key                       iterToKey,
                             Iter_to_node                      iterToNode,
                             Lower_bound                       lowerBound,
                             Upper_bound                       upperBound)
   {
      auto compare_it = [&](const auto& a, const auto& b)
      {
         if (a == containerEnd)
            return false;
         if (b == containerEnd)
            return true;
         return iterToKey(a) < iterToKey(b);
      };
      auto key_from_hex = [&](const std::optional<std::string>& s) -> std::optional<Key>
      {
         if (!s || s->empty())
            return {};
         // TODO: prevent from_bin aborting
         std::vector<char> bytes;
         bytes.reserve(s->size() / 2);
         if (from_hex(*s, bytes))
            return convert_from_bin<Key>(bytes);
         return {};
      };

      auto rangeBegin = containerBegin;
      auto rangeEnd   = containerEnd;
      if (ge)
         rangeBegin = std::max(rangeBegin, lowerBound(*ge), compare_it);
      if (gt)
         rangeBegin = std::max(rangeBegin, upperBound(*gt), compare_it);
      if (le)
         rangeEnd = std::min(rangeEnd, upperBound(*le), compare_it);
      if (lt)
         rangeEnd = std::min(rangeEnd, lowerBound(*lt), compare_it);
      rangeEnd = std::max(rangeBegin, rangeEnd, compare_it);

      auto it  = rangeBegin;
      auto end = rangeEnd;
      if (auto key = key_from_hex(after))
         it = std::clamp(upperBound(*key), rangeBegin, rangeEnd, compare_it);
      if (auto key = key_from_hex(before))
         end = std::clamp(lowerBound(*key), rangeBegin, rangeEnd, compare_it);
      end = std::max(it, end, compare_it);

      Connection result;
      auto       add_edge = [&](const auto& it)
      {
         auto bin    = convert_to_bin(iterToKey(it));
         auto cursor = to_hex(bin);
         result.edges.push_back(typename Connection::Edge{iterToNode(it), std::move(cursor)});
      };

      if (last && !first)
      {
         result.pageInfo.hasNextPage = end != rangeEnd;
         while (it != end && (*last)-- > 0)
         {
            decrIter(end);
            add_edge(end);
         }
         result.pageInfo.hasPreviousPage = end != rangeBegin;
         std::reverse(result.edges.begin(), result.edges.end());
      }
      else
      {
         result.pageInfo.hasPreviousPage = it != rangeBegin;
         for (; it != end && (!first || (*first)-- > 0); incrIter(it))
            add_edge(it);
         result.pageInfo.hasNextPage = it != rangeEnd;
         if (last && *last < result.edges.size())
         {
            result.pageInfo.hasPreviousPage = true;
            result.edges.erase(result.edges.begin(),
                               result.edges.begin() + (result.edges.size() - *last));
         }
      }

      if (!result.edges.empty())
      {
         result.pageInfo.startCursor = result.edges.front().cursor;
         result.pageInfo.endCursor   = result.edges.back().cursor;
      }
      return result;
   }
}  // namespace psio

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
