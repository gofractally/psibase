// TEMPORARY: removed when psio1 is deleted.
//
// Types declared with PSIO (PSIO_REFLECT, PSIO_ADAPTER) remain usable by this
// library while psibase is converted. Each PSIO-declared type here has a twin
// declared the old way; every legacy algorithm must treat the two alike.
#include <psio1/fracpack.hpp>
#include <psio1/from_json.hpp>
#include <psio1/graphql.hpp>
#include <psio1/schema.hpp>
#include <psio1/to_json.hpp>
#include <psio1/to_key.hpp>
#include <psio1/view.hpp>

#include <psio/adapter.hpp>
#include <psio/key.hpp>
#include <psio/pssz.hpp>
#include <psio/reflect.hpp>

#include <catch2/catch_all.hpp>

#include <chrono>
#include <optional>
#include <string>
#include <vector>

namespace glue
{
   // A 64-bit value with a text form, fixed layout: PSIO declaration.
   struct Tag
   {
      std::uint64_t value = 0;
      friend bool   operator==(const Tag&, const Tag&) = default;
      PSIO_REFLECT(Tag, definitionWillNotChange(), value)
   };
   struct TagText
   {
      static constexpr std::string_view schema_id = "GlueTag";
      static std::size_t packsize(const Tag& v) { return std::to_string(v.value).size() + 1; }
      static void        encode(const Tag& v, std::string& out)
      {
         out += '@';
         out += std::to_string(v.value);
      }
      static Tag decode(std::span<const char> text)
      {
         Tag out;
         for (std::size_t i = 1; i < text.size(); ++i)
            out.value = out.value * 10 + static_cast<std::uint64_t>(text[i] - '0');
         return out;
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         return !text.empty() && text[0] == '@' ? psio::codec_ok()
                                                : psio::codec_fail("GlueTag", 0, "GlueTag");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         return validate(text);
      }
   };

   // The same type declared for this library alone.
   struct OldTag
   {
      std::uint64_t value = 0;
      friend bool   operator==(const OldTag&, const OldTag&) = default;
      PSIO1_REFLECT(OldTag, definitionWillNotChange(), value)
   };
   template <typename S>
   void to_json(const OldTag& v, S& stream)
   {
      to_json("@" + std::to_string(v.value), stream);
   }
   template <typename S>
   void from_json(OldTag& v, S& stream)
   {
      auto text = stream.get_string();
      v.value   = 0;
      for (std::size_t i = 1; i < text.size(); ++i)
         v.value = v.value * 10 + static_cast<std::uint64_t>(text[i] - '0');
   }
   inline constexpr bool use_json_string_for_gql(OldTag*)
   {
      return true;
   }
   inline constexpr bool psio_custom_schema(OldTag*)
   {
      return true;
   }

   // An extensible record, declared at namespace scope with PSIO.
   struct Point
   {
      std::int32_t               x = 0;
      std::string                label;
      std::optional<std::int32_t> z;
      friend bool                operator==(const Point&, const Point&) = default;
   };
   PSIO_REFLECT(Point, x, label, z)

   struct OldPoint
   {
      std::int32_t               x = 0;
      std::string                label;
      std::optional<std::int32_t> z;
      friend bool                operator==(const OldPoint&, const OldPoint&) = default;
   };
   PSIO1_REFLECT(OldPoint, x, label, z)

   using Time = std::chrono::time_point<std::chrono::system_clock,
                                        std::chrono::duration<std::int64_t, std::micro>>;

   // Legacy records that hold them.
   struct Holder
   {
      Tag                tag;
      Point              point;
      std::optional<Tag> maybe;
      std::vector<Tag>   tags;
      Time               time;
      friend bool        operator==(const Holder&, const Holder&) = default;
   };
   PSIO1_REFLECT(Holder, tag, point, maybe, tags, time)

   struct OldHolder
   {
      OldTag                tag;
      OldPoint              point;
      std::optional<OldTag> maybe;
      std::vector<OldTag>   tags;
      Time                  time;
      friend bool           operator==(const OldHolder&, const OldHolder&) = default;
   };
   PSIO1_REFLECT(OldHolder, tag, point, maybe, tags, time)

   struct Root
   {
      Holder holder;
      Tag    echo(Tag tag) const { return tag; }
   };
   PSIO1_REFLECT(Root, holder, method(echo, tag))
}  // namespace glue

PSIO_ADAPTER(glue::Tag, psio::text_category, glue::TagText)

using namespace glue;

namespace
{
   const Holder    value{Tag{7}, Point{-3, "p", 9}, Tag{8}, {Tag{1}, Tag{2}}, Time{Time::duration{1500000}}};
   const OldHolder old{OldTag{7},
                       OldPoint{-3, "p", 9},
                       OldTag{8},
                       {OldTag{1}, OldTag{2}},
                       Time{Time::duration{1500000}}};
}  // namespace

TEST_CASE("PSIO-declared types: reflection", "[canonical]")
{
   static_assert(psio1::Reflected<Tag>);
   static_assert(psio1::Reflected<Point>);
   static_assert(psio1::reflect<Tag>::definitionWillNotChange);
   static_assert(!psio1::reflect<Point>::definitionWillNotChange);
   static_assert(psio1::is_packable<Tag>::fixed_size == 8);
   static_assert(!psio1::is_packable<Tag>::is_variable_size);
   static_assert(psio1::is_packable<Point>::is_variable_size);
   CHECK(std::string_view{psio1::get_type_name<Tag>()} == "Tag");
   CHECK(std::string_view{psio1::get_type_name<Point>()} == "Point");
   CHECK(std::string_view{psio1::get_type_name<std::vector<Tag>>()} == "Tag[]");
   CHECK(std::string_view{psio1::reflect<Point>::data_member_names[1]} == "label");
}

TEST_CASE("PSIO-declared types: fracpack bytes are those of the legacy declaration", "[canonical]")
{
   CHECK(psio1::convert_to_frac(Tag{0x0102030405060708}) ==
         psio1::convert_to_frac(OldTag{0x0102030405060708}));
   CHECK(psio1::convert_to_frac(Point{1, "abc", std::nullopt}) ==
         psio1::convert_to_frac(OldPoint{1, "abc", std::nullopt}));

   const auto bytes = psio1::convert_to_frac(value);
   CHECK(bytes == psio1::convert_to_frac(old));
   CHECK(psio1::fracpack_validate<Holder>(bytes) == psio1::validation_t::valid);
   CHECK(psio1::from_frac<Holder>(bytes) == value);
   // Either declaration reads the other's bytes.
   CHECK(psio1::from_frac<OldHolder>(bytes) == old);
   CHECK_FALSE(psio1::fracpack_validate<Holder>(std::span<const char>{bytes.data(), bytes.size() - 1}));
}

TEST_CASE("PSIO-declared types: views", "[canonical]")
{
   auto                       bytes = psio1::convert_to_frac(value);
   psio1::view<const Holder> view{psio1::prevalidated{bytes}};
   CHECK(view.tag().value() == 7u);
   CHECK(view.tag().unpack() == Tag{7});
   CHECK(view.point().x() == -3);
   CHECK(std::string_view{view.point().label()} == "p");
   CHECK(*view.point().z() == 9);
   CHECK(view.maybe()->value() == 8u);
   CHECK(view.tags().size() == 2);
   CHECK(view.tags()[1].value() == 2u);

   psio1::view<Holder> writable{psio1::prevalidated{bytes}};
   writable.tag().value() = 99;
   writable.point().x()   = 5;
   auto changed           = value;
   changed.tag.value      = 99;
   changed.point.x        = 5;
   CHECK(psio1::from_frac<Holder>(bytes) == changed);
}

TEST_CASE("PSIO-declared types: JSON", "[canonical]")
{
   const auto text = psio1::convert_to_json(value);
   CHECK(text == psio1::convert_to_json(old));
   CHECK(text.find(R"("tag":"@7")") != std::string::npos);
   CHECK(text.find(R"("point":{"x":-3,"label":"p","z":9})") != std::string::npos);
   CHECK(psio1::convert_from_json<Holder>(text) == value);
   CHECK(psio1::convert_to_json(Tag{12}) == R"("@12")");
   CHECK(psio1::convert_from_json<Tag>(R"("@12")") == Tag{12});
}

TEST_CASE("PSIO-declared types: keys", "[canonical]")
{
   CHECK(psio1::convert_to_key(Tag{0x0102030405060708}) ==
         psio1::convert_to_key(OldTag{0x0102030405060708}));
   CHECK(psio1::convert_to_key(value) == psio1::convert_to_key(old));
   CHECK(psio1::convert_to_key(std::tuple{Tag{1}, Point{2, "x", 3}}) ==
         psio1::convert_to_key(std::tuple{OldTag{1}, OldPoint{2, "x", 3}}));
}

TEST_CASE("PSIO-declared types: schema", "[canonical]")
{
   using namespace psio1::schema_types;
   static_assert(psio_custom_schema(static_cast<Tag*>(nullptr)));
   static_assert(!psio_custom_schema(static_cast<Point*>(nullptr)));

   auto        schema = psio1::SchemaBuilder{}.insert<Holder>("Holder").build();
   const auto* holder = std::get_if<Object>(&schema.types.find("Holder")->second.value);
   REQUIRE(holder);
   // The custom id is the one PSIO's own schema uses (the adapter's schema_id).
   const auto* tag = holder->members[0].type.resolve(schema);
   REQUIRE(std::holds_alternative<Custom>(tag->value));
   CHECK(std::get<Custom>(tag->value).id == "GlueTag");
   CHECK(std::holds_alternative<Struct>(std::get<Custom>(tag->value).type->resolve(schema)->value));
   const auto* point = holder->members[1].type.resolve(schema);
   CHECK(std::holds_alternative<Object>(point->value));

   // The compiled schema reads the fracpack bytes of the PSIO-declared types.
   CompiledSchema    compiled{schema};
   const auto        bytes = psio1::convert_to_frac(value);
   FracParser        parser{bytes, compiled, "Holder"};
   std::vector<char> out;
   psio1::vector_stream stream{out};
   to_json(parser, stream);
   const std::string text{out.data(), out.size()};
   CHECK(text.find(R"("point":{"x":-3,"label":"p","z":9})") != std::string::npos);
}

TEST_CASE("PSIO-declared types: GraphQL", "[canonical]")
{
   static_assert(psio1::use_json_string_for_gql(static_cast<Tag*>(nullptr)));
   static_assert(!psio1::use_json_string_for_gql(static_cast<Point*>(nullptr)));
   Root root{value};
   CHECK(psio1::gql_query(root, "{ holder { tag point { x label } tags } }", "") ==
         R"({"data": {"holder":{"tag":"@7","point":{"x":-3,"label":"p"},"tags":["@1","@2"]}}})");
   CHECK(psio1::gql_query(root, R"({ echo(tag: "@41") })", "") == R"({"data": {"echo":"@41"}})");
}

// The leaf shapes psibase converted first have the same bytes in both
// libraries: converting them changed no wire or key byte.
TEST_CASE("PSIO-declared types: leaf shapes are byte-identical in fracpack/PSSZ and in both key formats",
          "[canonical]")
{
   auto same = [](const auto& v)
   {
      const auto frac = psio1::convert_to_frac(v);
      const auto pssz = psio::encode(psio::pssz{}, v);
      CHECK(frac == std::vector<char>(pssz.begin(), pssz.end()));
      const auto oldKey = psio1::convert_to_key(v);
      const auto newKey = psio::to_key(v);
      CHECK(oldKey == std::vector<char>(newKey.begin(), newKey.end()));
   };
   using Seconds = std::chrono::duration<std::int64_t>;
   same(Tag{0x0102030405060708});
   same(Tag{});
   same(Time{Time::duration{1795342530123456}});
   same(Time{Time::duration{-1}});
   same(std::chrono::time_point<std::chrono::system_clock, Seconds>{Seconds{1795342530}});
   same(Seconds{-5});
   same(Time::duration{1500000});
   std::array<std::uint8_t, 32> digest{};
   for (std::size_t i = 0; i < digest.size(); ++i)
      digest[i] = static_cast<std::uint8_t>(0xf0 + i * 7);
   same(digest);
   same(std::array<std::uint8_t, 20>{});

   // Composite keys of those shapes agree too.
   auto sameKey = [](const auto& v)
   {
      const auto oldKey = psio1::convert_to_key(v);
      const auto newKey = psio::to_key(v);
      CHECK(oldKey == std::vector<char>(newKey.begin(), newKey.end()));
   };
   sameKey(std::tuple{Tag{7}, std::uint32_t{9}, digest});
   sameKey(std::tuple{Tag{7}, std::string{"a\0b", 3}, std::optional<std::uint32_t>{5}});
   sameKey(std::tuple{std::vector<std::uint16_t>{1, 2}, std::optional<std::uint64_t>{}});
}
