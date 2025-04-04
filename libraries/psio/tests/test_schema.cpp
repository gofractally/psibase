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
   CHECK(to_json(cschema, "s", "08000100000004000000") == R"({"value":null})");
   CHECK(to_json(cschema, "s", "0000") == R"({"value":null})");
}

TEST_CASE("schema resolve")
{
   Schema schema;
   schema.insert("i32", Int{.bits = 32, .isSigned = true});
   schema.insert("s", Object{{Member{"value", Option{"i32"}}}});
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "s", "0400040000002A000000") == R"({"value":42})");
   CHECK(to_json(cschema, "s", "08000100000004000000") == R"({"value":null})");
   CHECK(to_json(cschema, "s", "0000") == R"({"value":null})");
}

struct MyType
{
   std::uint32_t i;
};
PSIO_REFLECT(MyType, i)

struct MyType2
{
   std::uint8_t value;
};
PSIO_REFLECT(MyType2, definitionWillNotChange(), value)

#include <iostream>

TEST_CASE("schema generated")
{
   SchemaBuilder builder;
   builder.insert<std::uint8_t>("u8");
   builder.insert<std::optional<std::uint8_t>>("o");
   builder.insert<MyType>("s");
   builder.insert<std::vector<std::int32_t>>("v");
   builder.insert<std::variant<std::uint32_t>>("var");
   builder.insert<MyType2>("x");
   builder.insert<std::tuple<std::int8_t>>("tup");
   builder.insert<std::array<std::int16_t, 1>>("a");
   builder.insert<bool>("bool");
   builder.insert<float>("f32");
   builder.insert<double>("f64");
   Schema schema = std::move(builder).build();
   std::cout << psio::format_json(schema) << std::endl;
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "u8", "2A") == "42");
   CHECK(to_json(cschema, "o", "040000002A") == "42");
   CHECK(to_json(cschema, "s", "04002A000000") == R"({"i":42})");
   CHECK(to_json(cschema, "v", "00000000") == "[]");
   CHECK(to_json(cschema, "v", "040000002A00000000") == "[42]");
   CHECK(to_json(cschema, "var", "00040000002A000000") == R"({"uint32":42})");
   CHECK(to_json(cschema, "x", "2A") == R"({"value":42})");
   CHECK(to_json(cschema, "tup", "01002A") == "[42]");
   CHECK(to_json(cschema, "a", "2A00") == "[42]");
   CHECK(to_json(cschema, "bool", "01") == "true");
   CHECK(to_json(cschema, "f32", "0000803F") == "1");
   CHECK(to_json(cschema, "f64", "000000000000F03F") == "1");
}

TEST_CASE("schema serialization")
{
   SchemaBuilder builder;
   builder.insert<std::uint8_t>("u8");
   builder.insert<std::optional<std::uint8_t>>("o");
   builder.insert<MyType>("s");
   builder.insert<std::vector<std::int32_t>>("v");
   builder.insert<std::variant<std::uint32_t>>("var");
   builder.insert<MyType2>("x");
   builder.insert<std::tuple<std::int8_t>>("tup");
   builder.insert<std::array<std::int16_t, 1>>("a");
   builder.insert<bool>("bool");
   builder.insert<float>("f32");
   builder.insert<double>("f64");
   Schema schema       = std::move(builder).build();
   auto   schema_text  = convert_to_json(schema);
   auto   schema2      = convert_from_json<Schema>(schema_text);
   auto   schema_text2 = convert_to_json(schema2);
   CHECK(schema_text == schema_text2);
   auto schema_bin   = to_frac(schema);
   auto schema3      = from_frac<Schema>(schema_bin);
   auto schema_text3 = convert_to_json(schema3);
   CHECK(schema_text3 == schema_text);
}

template <typename T, typename U>
bool isExtension()
{
   Schema s1 = SchemaBuilder().insert<T>("T").build();
   Schema s2 = SchemaBuilder().insert<U>("U").build();
   return match(s1, s2, {{Type{"T"}, Type{"U"}}}) >= 0;
}

TEST_CASE("schema compat")
{
   CHECK(isExtension<std::uint8_t, std::uint8_t>());
   CHECK(!isExtension<std::uint8_t, std::int8_t>());
   CHECK(isExtension<std::tuple<>, std::tuple<std::optional<std::uint8_t>>>());
   CHECK(!isExtension<std::tuple<std::optional<std::uint8_t>>, std::tuple<>>());
}

TEST_CASE("schema error")
{
   CHECK_THROWS(
       []
       {
          Schema schema;
          schema.insert("T", Type{"T"});
          CompiledSchema{schema};
       }());
   CHECK_THROWS(
       []
       {
          Schema schema;
          schema.insert("T", Custom{.type = Type{"T"}, .id = "bool"});
          CompiledSchema{schema};
       }());
   CHECK_THROWS(
       []
       {
          Schema schema;
          schema.insert("T",
                        Custom{.type = Custom{.type = Type{"T"}, .id = "bool"}, .id = "string"});
          CompiledSchema{schema};
       }());
   CHECK_THROWS(
       []
       {
          Schema schema;
          schema.insert("T", Struct{});
          CompiledSchema{schema};
       }());
   CHECK_NOTHROW(
       []
       {
          Schema schema;
          schema.insert("T", Custom{.type = Option{Type{"T"}}, .id = "string"});
          CompiledSchema{schema};
       }());
   CHECK_NOTHROW(
       []
       {
          Schema schema;
          schema.insert("T", Option{Custom{.type = Type{"T"}, .id = "string"}});
          CompiledSchema{schema};
       }());
}

TEST_CASE("schema wrong custom")
{
   Schema schema;
   schema.insert("s", Custom{.type = List{Int{.bits = 32, .isSigned = true}}, .id = "string"});
   CompiledSchema cschema{schema};
   CHECK(to_json(cschema, "s", "040000002A000000") == R"([42])");
}

TEST_CASE("schema select")
{
   Schema schema;
   schema.insert("inner", Object{.members = {{.name = "d", .type = Int{.bits = 32}}}});
   schema.insert("outer", Object{.members = {{.name = "data", .type = Type{"inner"}}}});
   CompiledSchema cschema{schema};
   auto           input = unhex("04000400000004002A000000");
   FracParser     parser{input, cschema, "outer"};
   CompiledType*  innerType = cschema.get(schema.get("inner"));
   auto           saved     = parser.get_pos(parser.select_child(0));
   {
      parser.set_pos(saved);
      auto item = parser.parse(innerType);
      if (item.kind == FracParser::error)
         check(false, std::string_view(item.data.data(), item.data.size()));
      parser.push(parser.select_child(0));
      std::vector<char> data;
      vector_stream     out{data};
      to_json(parser, out);
      CHECK(std::string_view(data.data(), data.size()) == "42");
   }
}

TEST_CASE("schema schema")
{
   SchemaBuilder builder;
   builder.insert<std::uint8_t>("u8");
   builder.insert<std::optional<std::uint8_t>>("o");
   builder.insert<MyType>("s");
   builder.insert<std::vector<std::int32_t>>("v");
   builder.insert<std::variant<std::uint32_t>>("var");
   builder.insert<MyType2>("x");
   builder.insert<std::tuple<std::int8_t>>("tup");
   builder.insert<std::array<std::int16_t, 1>>("a");
   builder.insert<bool>("bool");
   builder.insert<float>("f32");
   builder.insert<double>("f64");
   Schema data   = std::move(builder).build();
   Schema schema = SchemaBuilder{}.insert<Schema>("schema").build();

   std::cout << psio::format_json(schema) << std::endl;
   CompiledSchema cschema{schema};
   auto           bin = psio::to_frac(data);

   FracParser        parser{bin, cschema, "schema"};
   std::vector<char> json;
   vector_stream     out{json};
   to_json(parser, out);
   CHECK(std::string_view{json.data(), json.size()} == psio::convert_to_json(data));
}
