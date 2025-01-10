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
PSIO_REFLECT(InputArg, one, two)

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
             world,
             hello,
             method(sum, a, b),
             method(cat, arg),
             method(getAccounts, first, before, last, after))

TEST_CASE("graphql", "[graphql]")
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

TEST_CASE("graphql_escape_sequences", "[graphql]")
{
   Root r{"hello", 42};

   // Test all escape sequences
   auto result1 =
       psio::gql_query(r, R"({ cat(arg: { one: "Hello\n\t\b\f\r\"\\\/", two: "World" }) })", "");
   REQUIRE(result1 == R"({"data": {"cat":"Hello\n\t\b\f\r\"\\/World"}})");

   // Test Unicode escape sequences
   auto result2 = psio::gql_query(
       r, R"({ cat(arg: { one: "\u0048\u0065\u006C\u006C\u006F", two: "World" }) })", "");
   REQUIRE(result2 == R"({"data": {"cat":"HelloWorld"}})");

   // Test that unknown escape sequences result in an error
   auto result3 = psio::gql_query(r, R"({ cat(arg: { one: "Hello\x", two: "World" }) })", "");
   REQUIRE(result3 == R"({"errors": {"message": "expected }"}})");

   // Test empty string followed by quote (should be valid)
   auto result4 = psio::gql_query(r, R"({ cat(arg: { one: "", two: "\"" }) })", "");
   REQUIRE(result4 == R"({"data": {"cat":"\""}})");

   // Test 2-byte Unicode character (ñ = U+00F1)
   auto result5 = psio::gql_query(r, R"({ cat(arg: { one: "Ma\u00F1ana", two: "" }) })", "");
   REQUIRE(result5 == R"({"data": {"cat":"Mañana"}})");

   // Test 3-byte Unicode character (€ = U+20AC)
   auto result6 = psio::gql_query(r, R"({ cat(arg: { one: "\u20AC100", two: "" }) })", "");
   REQUIRE(result6 == R"({"data": {"cat":"€100"}})");

   // Test 4-byte Unicode character using surrogate pair (🚀 = U+1F680)
   auto result7 = psio::gql_query(r, R"({ cat(arg: { one: "Launch\uD83D\uDE80", two: "" }) })", "");
   REQUIRE(result7 == R"({"data": {"cat":"Launch🚀"}})");

   // Test invalid surrogate pair (high surrogate without low surrogate)
   auto result8 = psio::gql_query(r, R"({ cat(arg: { one: "\uD83D", two: "" }) })", "");
   REQUIRE(result8 == R"({"errors": {"message": "expected }"}})");

   // Test invalid surrogate pair (low surrogate without high surrogate)
   auto result9 = psio::gql_query(r, R"({ cat(arg: { one: "\uDE80", two: "" }) })", "");
   REQUIRE(result9 == R"({"errors": {"message": "expected }"}})");
}

TEST_CASE("graphql_block_strings", "[graphql]")
{
   Root r{"hello", 42};

   // Test basic block string with backslash and quotes (should be preserved verbatim)
   auto result1 =
       psio::gql_query(r, R"({ cat(arg: { one: """Hello \n "quoted" World!""", two: "" }) })", "");
   REQUIRE(result1 == R"({"data": {"cat":"Hello \\n \"quoted\" World!"}})");

   // Test common indentation removal
   auto result2 = psio::gql_query(r, R"({ cat(arg: { one: """
        Hello
          World
        Goodbye
    """, two: "" }) })",
                                  "");
   REQUIRE(result2 == R"({"data": {"cat":"Hello\n  World\nGoodbye"}})");

   // Test empty lines at start and end are removed
   auto result3 = psio::gql_query(r, R"({ cat(arg: { one: """

        Hello
        World

    """, two: "" }) })",
                                  "");
   REQUIRE(result3 == R"({"data": {"cat":"Hello\nWorld"}})");

   // Test escaped triple quotes
   auto result4 =
       psio::gql_query(r, R"({ cat(arg: { one: """Hello \""" World""", two: "" }) })", "");
   REQUIRE(result4 == R"({"data": {"cat":"Hello \"\"\" World"}})");

   // Test mixed line endings (CRLF and LF)
   auto result5 = psio::gql_query(
       r, "{ cat(arg: { one: \"\"\"\r\nHello\rWorld\nGoodbye\r\n\"\"\", two: \"\" }) }", "");
   REQUIRE(result5 == R"({"data": {"cat":"Hello\nWorld\nGoodbye"}})");

   // Test empty block string
   auto result6 = psio::gql_query(r, R"({ cat(arg: { one: """""", two: "" }) })", "");
   REQUIRE(result6 == R"({"data": {"cat":""}})");

   // Test whitespace-only lines don't affect common indentation
   auto result7 = psio::gql_query(r, R"({ cat(arg: { one: """
        Hello
             
          World
        """, two: "" }) })",
                                  "");
   REQUIRE(result7 == R"({"data": {"cat":"Hello\n     \n  World"}})");

   // Test tab indentation
   auto result8 = psio::gql_query(r, R"({ cat(arg: { one: """
		Hello
			World
		Goodbye
""", two: "" }) })",
                                  "");
   REQUIRE(result8 == R"({"data": {"cat":"Hello\n\tWorld\nGoodbye"}})");

   // Test mixed space and tab indentation
   auto result9 = psio::gql_query(r, R"({ cat(arg: { one: """
	    Hello
	      World
	    Goodbye
""", two: "" }) })",
                                  "");
   REQUIRE(result9 == R"({"data": {"cat":"Hello\n  World\nGoodbye"}})");

   // Test non-printable ASCII characters are preserved
   auto result10 =
       psio::gql_query(r, R"({ cat(arg: { one: """Hello\u0007World""", two: "" }) })", "");
   REQUIRE(result10 == R"({"data": {"cat":"Hello\\u0007World"}})");

   // Test multiple consecutive empty lines in the middle
   auto result11 = psio::gql_query(r, R"({ cat(arg: { one: """
        Hello


        World
    """, two: "" }) })",
                                   "");
   REQUIRE(result11 == R"({"data": {"cat":"Hello\n\n\nWorld"}})");

   // Test lines with only whitespace in the middle
   auto result12 = psio::gql_query(r, R"({ cat(arg: { one: """
        Hello
        
           
        World
    """, two: "" }) })",
                                   "");
   REQUIRE(result12 == R"({"data": {"cat":"Hello\n\n   \nWorld"}})");

   // Test lines with mixed tabs and spaces for indentation
   auto result13 = psio::gql_query(r, R"({ cat(arg: { one: """
        Hello
	    	World
        	Goodbye
    """, two: "" }) })",
                                   "");
   REQUIRE(result13 == R"({"data": {"cat":"  Hello\nWorld\n  \tGoodbye"}})");
}
