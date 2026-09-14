#include <boost/core/demangle.hpp>
#include <catch2/catch_all.hpp>
#include <iostream>
#include <psio/graphql.hpp>
#include <psio/to_hex.hpp>

struct InputArg
{
   std::string one;
   std::string two;
};
PSIO_REFLECT(InputArg, one, two)

struct Root
{
   std::string world;
   int         hello;
   int64_t     sum(int a, int b) const { return a + b; }
   std::string cat(InputArg arg) const { return arg.one + arg.two; }
};

PSIO_REFLECT(Root, world, hello, method(sum, a, b), method(cat, arg))

TEST_CASE("graphql", "[graphql]")
{
   Root r{"hello", 42};

   std::cout << psio::gql_query(r, "{ hello, world, mysum: sum( a: 1, b: 2)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(r, "{ hello, world, sum( a: 1)  }", "");
   std::cout << "\n";
   std::cout << psio::gql_query(
       r, "{ hello, world, cat( arg: { two: \"hello\", one: \"world\"} )  }", "");

   std::cout << "\n";
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
