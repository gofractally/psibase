#include <psio/fracpack.hpp>
#include <psio/schema.hpp>
#include <psio/shared_view_ptr.hpp>
#include <psio/to_hex.hpp>
#include <psio/to_json.hpp>

#include "expand_json.hpp"

#include <iostream>

struct test_case
{
   std::string       type;
   std::string       json;
   std::vector<char> fracpack;
};
void to_json(const test_case& t, std::ostream& os)
{
   os << "{\"type\":\"" << t.type << "\""
      << ",\"json\":" << t.json << ",\"fracpack\":\"" << psio::to_hex(t.fracpack) << "\"}";
}

struct test_builder
{
   template <typename T>
   void add(const std::string& type, std::initializer_list<T> values)
   {
      builder.insert<T>(type);
      for (const T& value : values)
      {
         tests.push_back({type, psio::convert_to_json(value), psio::to_frac(value)});
      }
   }
   template <typename T>
   void add_nested(const std::string& type, std::initializer_list<T> values)
   {
      builder.expandNested(true);
      builder.insert<T>(type);
      builder.expandNested(false);
      for (const T& value : values)
      {
         tests.push_back({type, psio::expand_json(value), psio::to_frac(value)});
      }
   }
   psio::SchemaBuilder    builder;
   std::vector<test_case> tests;
   int                    next;
};

void to_json(test_builder& t, std::ostream& os)
{
   os << "{\"schema\":" << psio::convert_to_json(std::move(t.builder).build()) << ",\"values\":[";
   bool first = true;
   for (const auto& v : t.tests)
   {
      if (first)
         first = false;
      else
         os << ',';
      to_json(v, os);
   }
   os << "]}";
}

struct FixedStruct
{
   std::uint8_t v0;
   std::uint8_t v1;
};
PSIO_REFLECT(FixedStruct, definitionWillNotChange(), v0, v1)

struct VariableStruct
{
   std::uint8_t                v0;
   std::optional<std::uint8_t> v1;
};
PSIO_REFLECT(VariableStruct, definitionWillNotChange(), v0, v1)

struct Extensible
{
   std::uint8_t                v0;
   std::optional<std::uint8_t> v1;
   std::uint8_t                v2;
   std::optional<std::uint8_t> v3;
};
PSIO_REFLECT(Extensible, v0, v1, v2, v3)

struct V0
{
};
PSIO_REFLECT(V0)

struct V1
{
   std::uint8_t v0;
};
PSIO_REFLECT_TYPENAME(V1)
auto& clio_unwrap_packable(V1& v1)
{
   return v1.v0;
}
auto& clio_unwrap_packable(const V1& v1)
{
   return v1.v0;
}
void to_json(const V1& v1, auto& stream)
{
   to_json(v1.v0, stream);
}

struct Empty
{
};
PSIO_REFLECT(Empty, definitionWillNotChange())

int main()
{
   test_builder builder;
   builder.builder.expandNested();
   builder.add<std::int8_t>("i8", {0, 1, -1});
   builder.add<std::uint8_t>("u8", {0, 1, 0xffu});
   builder.add<std::int16_t>("i16", {0, 1, -1});
   builder.add<std::uint16_t>("u16", {0, 1, 0xffffu});
   builder.add<std::int32_t>("i32", {0, 1, -1});
   builder.add<std::uint32_t>("u32", {0, 1, 0xffffffffu});
   builder.add<std::int64_t>("i64", {0, 1, -1});
   builder.add<std::uint64_t>("u64", {0, 1, 0xffffffffffffffffu});
   builder.add<float>(
       "f32", {0.f, 1.f, -1.f, std::numeric_limits<float>::infinity(),
               -std::numeric_limits<float>::infinity(), std::numeric_limits<float>::denorm_min(),
               -std::numeric_limits<float>::denorm_min(), std::numeric_limits<float>::quiet_NaN()});
   builder.add<double>(
       "f64",
       {0., 1., -1., std::numeric_limits<double>::infinity(),
        -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::denorm_min(),
        -std::numeric_limits<double>::denorm_min(), std::numeric_limits<double>::quiet_NaN()});
   builder.add<FixedStruct>("FixedStruct", {{0, 0}, {1, 2}});
   builder.add<VariableStruct>("VariableStruct", {{0, 0}, {1, 2}, {3, std::nullopt}});
   builder.add<Extensible>("Extensible", {{0, 0, 0, 0},
                                          {1, 2, 3, 4},
                                          {5, std::nullopt, 6, 7},
                                          {8, 9, 10, std::nullopt},
                                          {11, std::nullopt, 12, std::nullopt}});
   builder.add<std::array<std::int8_t, 2>>("i8[2]", {{0, 1}});
   builder.add<std::array<std::optional<std::uint8_t>, 2>>("opt<u8>[2]",
                                                           {{0, 1}, {2, std::nullopt}});
   builder.add<std::optional<std::uint8_t>>("opt-u8", {0, 1, -1, std::nullopt});
   builder.add<std::vector<std::int8_t>>("i8[]", {{}, {1}, {2, 3}});
   builder.add<std::vector<std::optional<std::uint8_t>>>(
       "opt<u8>[]", {{}, {std::nullopt}, {1, std::nullopt, 2}});
   builder.add<std::variant<V0, V1>>("var", {V0{}, V1{1}});
   builder.add<std::tuple<std::uint8_t, std::optional<std::uint8_t>>>("(u8, opt<u8>)",
                                                                      {{0, 1}, {2, std::nullopt}});
   builder.add<std::tuple<std::vector<std::int8_t>>>("(i8[])", {{{}}, {{1, 2}}});
   builder.add_nested<psio::shared_view_ptr<std::uint64_t>>("nested", {std::uint64_t{0}, 1});
   builder.add<bool>("bool", {false, true});
   builder.add<std::string>("str", {"", "The quick brown fox jumps over the lazy dog"});
   builder.add<std::array<unsigned char, 2>>("hex2", {{7, 10}});
   builder.add<std::vector<unsigned char>>("hex", {{}, {23, 45, 67}});
   builder.add<std::tuple<std::vector<unsigned char>>>("(hex)", {{{}}, {{23, 45, 67}}});
   builder.add<psio::shared_view_ptr<std::int64_t>>("nestedhex", {42});
   builder.add_nested<std::tuple<psio::shared_view_ptr<Empty>>>("nested-empty", {{Empty{}}});
   builder.add<std::tuple<psio::shared_view_ptr<Empty>>>("nested-empty-hex", {{Empty{}}});
   std::cout << "[";
   to_json(builder, std::cout);
   std::cout << "]";
}
