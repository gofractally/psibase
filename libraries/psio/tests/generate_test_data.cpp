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
   bool              error = false;
   std::vector<char> compat;
};
void to_json(const test_case& t, std::ostream& os)
{
   os << "{\"type\":\"" << t.type << "\"";
   if (!t.json.empty())
      os << ",\"json\":" << t.json;
   os << ",\"fracpack\":\"" << psio::to_hex(t.fracpack) << "\"";
   if (t.error)
      os << ",\"error\":true";
   if (!t.compat.empty())
      os << ",\"compat\":\"" << psio::to_hex(t.compat) << "\"";
   os << "}";
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
   template <typename T, typename U>
   void add_compat(const std::string& type, T value, U expected)
   {
      builder.insert<U>(type);
      tests.push_back({type, psio::convert_to_json(expected), psio::to_frac(expected), false,
                       psio::to_frac(value)});
   }
   template <typename T>
   void add_errors(const std::string& type, std::initializer_list<std::string_view> data)
   {
      builder.insert<T>(type);
      for (auto row : data)
      {
         test_case t{type, "", {}, true};
         psio::from_hex(row, t.fracpack);
         tests.push_back(std::move(t));
      }
   }
   psio::SchemaBuilder    builder;
   std::vector<test_case> tests;
   int                    next;
};

void to_json(test_builder& t, std::ostream& os)
{
   auto schema = std::move(t.builder).build();
   os << "{\"schema\":" << psio::convert_to_json(schema)
      << ",\"schema_bin\":" << psio::convert_to_json(psio::to_frac(schema)) << ",\"schema_schema\":"
      << psio::convert_to_json(psio::SchemaBuilder{}.insert<psio::Schema>("schema").build())
      << ",\"values\":[";
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

// Trailing optional is not elided
struct VariableStruct
{
   std::uint8_t                v0;
   std::optional<std::uint8_t> v1;
};
PSIO_REFLECT(VariableStruct, definitionWillNotChange(), v0, v1)

// Fixed data contains offsets
struct VariableStruct2
{
   std::vector<std::int32_t> v1;
   std::vector<std::int8_t>  v2;
};
PSIO_REFLECT(VariableStruct2, definitionWillNotChange(), v1, v2)

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

struct Empty2
{
};
PSIO_REFLECT(Empty2, definitionWillNotChange())

namespace nnn
{
   struct string
   {
      std::int32_t value;
   };
   PSIO_REFLECT(string, value)

   constexpr bool psio_custom_schema(string*)
   {
      return true;
   }
}  // namespace nnn
using WrongCustom = nnn::string;

struct OffsetTest
{
   std::uint32_t               v0;
   std::optional<std::uint8_t> v1;
};
PSIO_REFLECT(OffsetTest, v0, v1)

struct GapTest0
{
   std::uint32_t v0;
};
PSIO_REFLECT(GapTest0, v0)

struct GapTest1
{
   std::uint32_t               v0;
   std::optional<std::uint8_t> v1;
};
PSIO_REFLECT(GapTest1, v0, v1)

struct GapTest
{
   GapTest0 v0;
   GapTest1 v1;
};
PSIO_REFLECT(GapTest, v0, v1)

struct EmptyObject
{
};
PSIO_REFLECT(EmptyObject)

struct TrailingTest
{
   std::optional<std::uint8_t> v0;
};
PSIO_REFLECT(TrailingTest, v0)

struct StringMember
{
   std::string v0;
};
PSIO_REFLECT(StringMember, v0)

struct BytesMember
{
   std::vector<std::uint8_t> v0;
};
PSIO_REFLECT(BytesMember, v0)

struct VecTupleMember
{
   std::vector<std::tuple<>> v0;
};
PSIO_REFLECT(VecTupleMember, v0)

struct IntMember
{
   std::int32_t v0;
};
PSIO_REFLECT(IntMember, v0)

struct EmptyMember
{
   Empty v0;
};
PSIO_REFLECT(EmptyMember, v0)

struct EmptyTrailing
{
   std::optional<std::int32_t> v0;
   Empty                       v1;
};
PSIO_REFLECT(EmptyTrailing, v0, v1)

struct Untagged
{
   std::string value;
};
PSIO_REFLECT_TYPENAME(Untagged)
auto& clio_unwrap_packable(Untagged& obj)
{
   return obj.value;
}
auto& clio_unwrap_packable(const Untagged& obj)
{
   return obj.value;
}
void from_json(Untagged& obj, auto& stream)
{
   from_json(obj.value, stream);
}
void to_json(const Untagged& obj, auto& stream)
{
   to_json(obj.value, stream);
}
constexpr bool psio_is_untagged(const Untagged*)
{
   return true;
}

int main()
{
   test_builder builder;
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
   builder.add<VariableStruct2>("VariableStruct2", {{{-1}, {3, 4, 5}}});
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
   builder.add_nested<std::tuple<psio::shared_view_ptr<Empty2>>>("nested-empty", {{Empty2{}}});
   builder.add<std::tuple<psio::shared_view_ptr<Empty>>>("nested-empty-hex", {{Empty{}}});
   builder.add<std::tuple<std::optional<std::optional<std::vector<std::int8_t>>>>>(
       "OptionOption", {{std::optional{std::vector<std::int8_t>()}}});
   builder.add<WrongCustom>("WrongCustom", {{3}});
   builder.add<std::tuple<Empty>>("(Empty)", {{Empty{}}});
   builder.add<EmptyMember>("EmptyMember", {{Empty{}}});
   builder.add<std::map<std::string, std::string>>("string-map",
                                                   {{}, {{"foo", "x"}, {"bar", "y"}}});
   builder.add<std::variant<V0, Untagged>>("untagged-alternative", {V0{}, Untagged{"foo"}});

   // Compatible serialization
   builder.add_compat("(i32)", std::tuple<std::int32_t, std::optional<std::int32_t>>(42, 43),
                      std::tuple<std::int32_t>(42));
   builder.add_compat("()", std::tuple<std::optional<std::uint8_t>>(42), std::tuple());
   builder.add_compat("IntMember", std::tuple<std::int32_t, std::optional<std::int32_t>>(42, 43),
                      IntMember{42});
   builder.add_compat(
       "((),)",
       std::tuple(std::tuple(std::optional{std::uint8_t{0xFF}}), std::optional{std::uint8_t{0xCC}}),
       std::tuple<std::tuple<>>{});

   // bool is 0 or 1
   builder.add_errors<bool>("bool", {"02", "03", "FF"});
   // optional must be 1 or an offset pointer
   builder.add_errors<std::optional<std::uint8_t>>(
       "opt-u8", {"00000000", "02000000", "03000000", "05000000FFFF"});
   // vector byte size must be a multiple of the element size
   builder.add_errors<std::vector<std::uint16_t>>("vec-u16", {"03000000FFFFFFFFFFFF"});
   // negative offset
   builder.add_errors<std::tuple<std::uint32_t, std::optional<std::uint8_t>>>(
       "(u32,u8?)", {"0800CCCCCCCCFFFFFFFF"});
   builder.add_errors<OffsetTest>("OffsetTest", {"0800CCCCCCCCFFFFFFFF"});
   // gaps after unknown fields
   builder.add_errors<std::tuple<std::tuple<std::uint32_t>,
                                 std::tuple<std::uint32_t, std::optional<std::uint8_t>>>>(
       "((u32),(u32,u8?))", {"0800"
                             "08000000"
                             "0F000000"
                             "0800CCCCCCCC04000000FF"
                             "0800DDDDDDDD05000000EEEE"});
   builder.add_errors<GapTest>("GapTest", {"0800"
                                           "08000000"
                                           "0F000000"
                                           "0800CCCCCCCC04000000FF"
                                           "0800DDDDDDDD05000000EEEE"});
   // Malformed extensions
   builder.add_errors<std::tuple<>>(
       "()", {"0100FF", "040002000000", "040005000000FFFF", "08000800000005000000",
              "08000100000005000000FF", "0C000C0000000900000004000000FF"});
   builder.add_errors<EmptyObject>(
       "EmptyObject", {"0100FF", "040002000000", "040005000000FFFF", "08000800000005000000",
                       "08000100000005000000FF", "0C000C0000000900000004000000FF"});

   // variant cannot unpack unknown alternatives; known alternatives must have the correct size
   builder.add_errors<std::variant<std::uint8_t>>("UnknownAlt", {"0002000000FFFF", "0101000000FF"});
   // No trailing empty optionals
   builder.add_errors<std::tuple<std::optional<std::uint8_t>>>(
       "(u8?)", {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   builder.add_errors<std::tuple<>>(
       "()", {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   builder.add_errors<TrailingTest>(
       "TrailingTest", {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   builder.add_errors<EmptyObject>(
       "EmptyObject", {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   // Offset pointer to empty container must use compression
   builder.add_errors<std::optional<std::string>>("opt-str", {"0400000000000000"});
   builder.add_errors<std::optional<std::vector<std::uint8_t>>>("opt-bytes", {"0400000000000000"});
   builder.add_errors<std::optional<std::vector<std::tuple<>>>>("()[]?", {"0400000000000000"});
   builder.add_errors<std::tuple<std::string>>("(str)", {"04000400000000000000"});
   builder.add_errors<std::tuple<std::vector<std::uint8_t>>>("(u8[])", {"04000400000000000000"});
   builder.add_errors<std::tuple<std::vector<std::tuple<>>>>("(()[])", {"04000400000000000000"});
   builder.add_errors<StringMember>("StringMember", {"04000400000000000000"});
   builder.add_errors<BytesMember>("BytesMember", {"04000400000000000000"});
   builder.add_errors<VecTupleMember>("VecTupleMember", {"04000400000000000000"});
   builder.add_errors<std::tuple<std::optional<std::int32_t>, Empty>>("(i32?, Empty)", {"0000"});
   builder.add_errors<EmptyTrailing>("EmptyTrailing", {"0000"});

   std::cout << "[";
   to_json(builder, std::cout);
   std::cout << "]";
}
