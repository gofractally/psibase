#include <psio/schema.hpp>

#include <catch2/catch.hpp>

using namespace psio;
using namespace psio::schema_types;

std::vector<char> unhex(std::string_view data)
{
   constexpr std::string_view ws = " \t\r\n";
   std::vector<char>          result;
   auto                       begin     = data.begin();
   auto                       end       = data.end();
   auto                       get_digit = [&](uint8_t& nibble)
   {
      while (true)
      {
         if (begin == end)
            return false;
         if (ws.find(*begin) == std::string::npos)
            break;
         ++begin;
      }
      if (*begin >= '0' && *begin <= '9')
         nibble = *begin++ - '0';
      else if (*begin >= 'a' && *begin <= 'f')
         nibble = *begin++ - 'a' + 10;
      else if (*begin >= 'A' && *begin <= 'F')
         nibble = *begin++ - 'A' + 10;
      else
         check(false, std::string("Unexpected character in hex string: " + *begin));
      return true;
   };
   while (true)
   {
      uint8_t h, l;
      if (!get_digit(h))
         return result;
      if (!get_digit(l))
         check(false, "Incomplete byte");
      result.push_back((h << 4) | l);
   }
}

std::string to_json(const CompiledSchema& schema, const std::string& name, std::string_view hexdata)
{
   auto              input = unhex(hexdata);
   FracParser        parser{input, schema, name};
   std::vector<char> data;
   vector_stream     out{data};
   to_json(parser, out);
   return std::string(data.data(), data.size());
}

TEST_CASE("schema object")
{
   Schema schema;
   schema.insert("s", Object{{Member{"value", Int{.bits = 32, .isSigned = true}}}});
   auto              input = unhex("04002A000000");
   CompiledSchema    cschema{schema};
   FracParser        parser{input, cschema, "s"};
   std::vector<char> data;
   vector_stream     out{data};
   to_json(parser, out);
   CHECK(std::string_view(data.data(), data.size()) == R"({"value":42})");
}

TEST_CASE("schema optional member")
{
   Schema schema;
   schema.insert("s", Object{{Member{"value", Option{Int{.bits = 32, .isSigned = true}}}}});
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "s", "0400040000002A000000") == R"({"value":42})");
   CHECK(to_json(cschema, "s", "08000100000004000000") == R"({})");
   CHECK(to_json(cschema, "s", "0000") == R"({})");
}

TEST_CASE("schema resolve")
{
   Schema schema;
   schema.insert("i32", Int{.bits = 32, .isSigned = true});
   schema.insert("s", Object{{Member{"value", Option{"i32"}}}});
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "s", "0400040000002A000000") == R"({"value":42})");
   CHECK(to_json(cschema, "s", "08000100000004000000") == R"({})");
   CHECK(to_json(cschema, "s", "0000") == R"({})");
}

struct MyType
{
   std::uint32_t i;
};
PSIO_REFLECT(MyType, i)

#include <iostream>

TEST_CASE("schema generated")
{
   Schema schema;
   schema.insert<std::uint8_t>("u8");
   schema.insert<std::optional<std::uint8_t>>("o");
   schema.insert<MyType>("s");
   schema.insert<std::vector<std::int32_t>>("v");
   std::cout << psio::format_json(schema) << std::endl;
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "u8", "2A") == "42");
   CHECK(to_json(cschema, "o", "040000002A") == "42");
   CHECK(to_json(cschema, "s", "04002A000000") == R"({"i":42})");
   CHECK(to_json(cschema, "v", "00000000") == "[]");
   CHECK(to_json(cschema, "v", "040000002A00000000") == "[42]");
}
