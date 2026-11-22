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

// Records of psibase itself, pinned below.
#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <services/user/Nft.hpp>

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

   // A record without members (psibase has several: TLSInfo, ...).
   struct Nothing
   {
      friend bool operator==(const Nothing&, const Nothing&) = default;
   };
   PSIO_REFLECT(Nothing)
   struct OldNothing
   {
      friend bool operator==(const OldNothing&, const OldNothing&) = default;
   };
   PSIO1_REFLECT(OldNothing)

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
   // The name is the FixedString a legacy declaration has; psibase builds
   // GraphQL type names from it at compile time.
   static_assert(std::is_same_v<decltype(psio1::reflect<Point>::name),
                                const psio1::FixedString<5>>);
   static_assert(std::string_view{psio1::reflect<Point>::name + "Edge"} == "PointEdge");
   static_assert(std::string_view{psio1::reflect<OldPoint>::name + "Edge"} == "OldPointEdge");

   // The member names are an array of exactly the members; psibase iterates it.
   static_assert(std::size(psio1::reflect<Point>::data_member_names) == 3);
   std::string names;
   for (const char* name : psio1::reflect<Point>::data_member_names)
      names += name;
   CHECK(names == "xlabelz");
   static_assert(sizeof(psio1::reflect<Nothing>::data_member_names) ==
                 sizeof(psio1::reflect<OldNothing>::data_member_names));
   CHECK(psio1::convert_to_frac(Nothing{}) == psio1::convert_to_frac(OldNothing{}));
   CHECK(psio1::convert_to_json(Nothing{}) == psio1::convert_to_json(OldNothing{}));
   CHECK(psio1::convert_to_frac(std::optional<Nothing>{Nothing{}}) ==
         psio1::convert_to_frac(std::optional<OldNothing>{OldNothing{}}));
   CHECK(psio1::from_frac<Nothing>(psio1::convert_to_frac(Nothing{})) == Nothing{});
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

// ---------------------------------------------------------------------------
// psibase's own records. The expected values below were produced by the tree
// before these records were re-declared with PSIO_REFLECT (commit 071fff6eb,
// every one of them declared with PSIO1_REFLECT). Declaring a record with
// PSIO does not change one byte of what this library produces for it.
// ---------------------------------------------------------------------------
// They are declared with PSIO now (the records psibase defers are listed in
// doc/pssz-conversion.md).
static_assert(psio::Reflected<psibase::Action> && psio::Reflected<psibase::Tapos> &&
              psio::Reflected<psibase::Transaction> && psio::Reflected<psibase::SignedTransaction> &&
              psio::Reflected<psibase::BlockHeader> && psio::Reflected<psibase::Consensus> &&
              psio::Reflected<psibase::BftConsensus> && psio::Reflected<psibase::ActionTrace> &&
              psio::Reflected<psibase::StatusRow> && psio::Reflected<psibase::CodeRow> &&
              psio::Reflected<psibase::KvResourceKey> && psio::Reflected<UserService::NftRecord>);
static_assert(psio::is_dwnc_v<psibase::Tapos> && !psio::is_dwnc_v<psibase::Action>);

namespace
{
   std::string hex(const std::vector<char>& bytes)
   {
      static const char digits[] = "0123456789abcdef";
      std::string       out;
      for (unsigned char c : bytes)
      {
         out += digits[c >> 4];
         out += digits[c & 15];
      }
      return out;
   }
   template <typename T>
   std::string frac(const T& v)
   {
      return hex(psio1::convert_to_frac(v));
   }
   template <typename T>
   std::string key(const T& v)
   {
      return hex(psio1::convert_to_key(v));
   }
   template <typename T>
   std::string json(const T& v)
   {
      return psio1::convert_to_json(v);
   }
   // FNV-1a, to pin long texts (schemas).
   std::uint64_t fnv(std::string_view text)
   {
      std::uint64_t h = 0xcbf29ce484222325ull;
      for (unsigned char c : text)
         h = (h ^ c) * 0x100000001b3ull;
      return h;
   }
   template <typename T>
   std::string schemaOf(const char* name)
   {
      return psio1::convert_to_json(psio1::SchemaBuilder{}.insert<T>(name).build());
   }
   // Both directions of both text and binary must agree with the pinned form.
   template <typename T>
   void roundTrips(const T& v)
   {
      const auto bytes = psio1::convert_to_frac(v);
      REQUIRE(psio1::fracpack_validate<T>(bytes) == psio1::validation_t::valid);
      CHECK(psio1::convert_to_frac(psio1::from_frac<T>(bytes)) == bytes);
      CHECK(psio1::convert_to_frac(psio1::convert_from_json<T>(psio1::convert_to_json(v))) == bytes);
   }

   psibase::Checksum256 digest(std::uint8_t first)
   {
      psibase::Checksum256 out;
      for (std::size_t i = 0; i < out.size(); ++i)
         out[i] = static_cast<std::uint8_t>(first + i);
      return out;
   }

   using psibase::AccountNumber;
   using psibase::MethodNumber;

   psibase::Action pinnedAction()
   {
      return {AccountNumber{"alice"}, AccountNumber{"tokens"}, MethodNumber{"credit"}, {1, 2, 3}};
   }
   psibase::Transaction pinnedTransaction()
   {
      psibase::Transaction trx;
      trx.tapos.expiration     = psibase::TimePointSec{psibase::Seconds{1795342530}};
      trx.tapos.refBlockSuffix = 0x01020304;
      trx.tapos.flags          = 1;
      trx.tapos.refBlockIndex  = 5;
      trx.actions              = {pinnedAction(),
                                  {AccountNumber{"bob"}, AccountNumber{"nft"}, MethodNumber{"mint"}, {}}};
      trx.claims               = {{AccountNumber{"verify-sig"}, {9, 8}}};
      return trx;
   }
   psibase::Consensus pinnedConsensus(bool bft)
   {
      psibase::Consensus       out;
      std::vector<psibase::Producer> producers{
          {AccountNumber{"prod"}, {AccountNumber{"verify-sig"}, {4, 5, 6}}},
          {AccountNumber{"prod2"}, {AccountNumber{}, {}}}};
      if (bft)
         out.data = psibase::BftConsensus{producers};
      else
         out.data = psibase::CftConsensus{producers};
      out.services   = {{AccountNumber{"verify-sig"}, digest(0x40), 1, 2}};
      out.wasmConfig = {3, {1024, 512, 8192, 1048576}};
      return out;
   }
   psibase::BlockHeader pinnedHeader(bool withOptionals)
   {
      psibase::BlockHeader h;
      h.previous        = digest(0x10);
      h.blockNum        = 7;
      h.time            = psibase::BlockTime{psibase::MicroSeconds{1795342530123456}};
      h.producer        = AccountNumber{"prod"};
      h.term            = 3;
      h.commitNum       = 5;
      h.consensusState  = digest(0x20);
      h.trxMerkleRoot   = digest(0x30);
      h.eventMerkleRoot = digest(0x50);
      if (withOptionals)
      {
         h.newConsensus = pinnedConsensus(true);
         h.authCode     = {{{1, 2, {0xde, 0xad}}}};
      }
      return h;
   }
}  // namespace

TEST_CASE("psibase records: an action", "[canonical][records]")
{
   const auto v = pinnedAction();
   CHECK(frac(v) ==
         "1c0000b82a1b83aedf0400342d8afa07a40d7ac61600000000000400000003000000010203");
   CHECK(key(v) ==
         "04dfae831b2ab8000da407fa8a2d3400000000000016c67a8182830000");
   CHECK(json(v) ==
         R"({"sender":"alice","service":"tokens","method":"credit","rawData":"010203"})");
   CHECK(std::string_view{psio1::get_type_name<psibase::Action>()} == "Action");
   CHECK(std::string_view{psio1::reflect<psibase::Action>::data_member_names[3]} == "rawData");
   static_assert(!psio1::reflect<psibase::Action>::definitionWillNotChange);
   roundTrips(v);

   auto                              bytes = psio1::convert_to_frac(v);
   psio1::view<const psibase::Action> view{psio1::prevalidated{bytes}};
   CHECK(view.sender().unpack() == AccountNumber{"alice"});
   CHECK(view.method().value() == MethodNumber{"credit"}.value);
   CHECK(view.rawData().size() == 3);
}

TEST_CASE("psibase records: a transaction", "[canonical][records]")
{
   const auto trx = pinnedTransaction();
   CHECK(frac(trx) ==
         "1700c2c0026b000000000403020101000508000000530000000800000008000000290000001c0000b82a1b83aedf0400342d8afa07a40d7ac616000000000004000000030000000102031c000029a41b0b345e050066533bcc77c60aabc8c000000000000000000004000000040000000c00004a3347810e700e04000000020000000908");
   CHECK(key(trx.tapos) == "800000006b02c0c201020304000105");
   CHECK(json(trx) ==
         R"({"tapos":{"expiration":"2026-11-22T10:15:30Z","refBlockSuffix":16909060,"flags":1,"refBlockIndex":5},"actions":[{"sender":"alice","service":"tokens","method":"credit","rawData":"010203"},{"sender":"bob","service":"nft","method":"mint","rawData":""}],"claims":[{"service":"verify-sig","rawData":"0908"}]})");
   static_assert(psio1::reflect<psibase::Tapos>::definitionWillNotChange);
   static_assert(psio1::is_packable<psibase::Tapos>::fixed_size == 15);
   roundTrips(trx);

   psibase::SignedTransaction signedTrx{psio1::shared_view_ptr<psibase::Transaction>{trx}, {{7, 7}}, {}};
   CHECK(frac(signedTrx) ==
         "0800080000008c000000840000001700c2c0026b000000000403020101000508000000530000000800000008000000290000001c0000b82a1b83aedf0400342d8afa07a40d7ac616000000000004000000030000000102031c000029a41b0b345e050066533bcc77c60aabc8c000000000000000000004000000040000000c00004a3347810e700e040000000200000009080400000004000000020000000707");
   CHECK(json(signedTrx) ==
         R"({"transaction":"1700C2C0026B000000000403020101000508000000530000000800000008000000290000001C0000B82A1B83AEDF0400342D8AFA07A40D7AC616000000000004000000030000000102031C000029A41B0B345E050066533BCC77C60AABC8C000000000000000000004000000040000000C00004A3347810E700E04000000020000000908","proofs":["0707"],"subjectiveData":null})");
   // A trailing optional that is present.
   signedTrx.subjectiveData = {{{1}, {}}};
   CHECK(frac(signedTrx) ==
         "0c000c000000900000009a000000840000001700c2c0026b000000000403020101000508000000530000000800000008000000290000001c0000b82a1b83aedf0400342d8afa07a40d7ac616000000000004000000030000000102031c000029a41b0b345e050066533bcc77c60aabc8c000000000000000000004000000040000000c00004a3347810e700e0400000002000000090804000000040000000200000007070800000008000000000000000100000001");
   CHECK(json(signedTrx) ==
         R"({"transaction":"1700C2C0026B000000000403020101000508000000530000000800000008000000290000001C0000B82A1B83AEDF0400342D8AFA07A40D7AC616000000000004000000030000000102031C000029A41B0B345E050066533BCC77C60AABC8C000000000000000000004000000040000000C00004A3347810E700E04000000020000000908","proofs":["0707"],"subjectiveData":["01",""]})");
   CHECK(fnv(schemaOf<psibase::SignedTransaction>("SignedTransaction")) == 0x782a90f11ef1a02bull);
}

TEST_CASE("psibase records: a block header", "[canonical][records]")
{
   // Trailing optionals absent: they are not written at all.
   const auto bare = pinnedHeader(false);
   CHECK(frac(bare) ==
         "9c00101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f07000000c016c2c1da600600007185b64f77d70b0300000005000000202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f");
   CHECK(json(bare) ==
         R"({"previous":"101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F","blockNum":7,"time":"2026-11-22T10:15:30.123456Z","producer":"prod","term":3,"commitNum":5,"consensusState":"202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F","trxMerkleRoot":"303132333435363738393A3B3C3D3E3F404142434445464748494A4B4C4D4E4F","eventMerkleRoot":"505152535455565758595A5B5C5D5E5F606162636465666768696A6B6C6D6E6F","newConsensus":null,"authCode":null})");
   roundTrips(bare);

   // With a new consensus (a variant) and auth code.
   const auto full = pinnedHeader(true);
   CHECK(frac(full) ==
         "a400101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f07000000c016c2c1da600600007185b64f77d70b0300000005000000202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f08000000b80000000c000c0000005e0000008e00000001510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f0102080003000000040000001000000400000002000000200000000010000400000004000000060001020400000002000000dead");
   CHECK(json(full) ==
         R"({"previous":"101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F","blockNum":7,"time":"2026-11-22T10:15:30.123456Z","producer":"prod","term":3,"commitNum":5,"consensusState":"202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F","trxMerkleRoot":"303132333435363738393A3B3C3D3E3F404142434445464748494A4B4C4D4E4F","eventMerkleRoot":"505152535455565758595A5B5C5D5E5F606162636465666768696A6B6C6D6E6F","newConsensus":{"data":{"BftConsensus":{"producers":[{"name":"prod","auth":{"service":"verify-sig","rawData":"040506"}},{"name":"prod2","auth":{"service":"","rawData":""}}]}},"services":[{"codeNum":"verify-sig","codeHash":"404142434445464748494A4B4C4D4E4F505152535455565758595A5B5C5D5E5F","vmType":1,"vmVersion":2}],"wasmConfig":{"numExecutionMemories":3,"vmOptions":{"max_mutable_global_bytes":1024,"max_pages":512,"max_table_elements":8192,"max_stack_bytes":1048576}}},"authCode":[{"vmType":1,"vmVersion":2,"code":"DEAD"}]})");
   roundTrips(full);
   CHECK(fnv(schemaOf<psibase::BlockHeader>("BlockHeader")) == 0xbc66aac7e94b07d8ull);

   auto                                   bytes = psio1::convert_to_frac(full);
   psio1::view<const psibase::BlockHeader> view{psio1::prevalidated{bytes}};
   CHECK(view.blockNum() == 7u);
   CHECK(view.producer().unpack() == AccountNumber{"prod"});
   REQUIRE(view.newConsensus().has_value());
   CHECK(view.newConsensus()->wasmConfig().numExecutionMemories() == 3u);
   CHECK(view.newConsensus()->services()[0].vmVersion() == 2);
}

TEST_CASE("psibase records: a record that carries a variant", "[canonical][records]")
{
   const auto cft = pinnedConsensus(false);
   const auto bft = pinnedConsensus(true);
   CHECK(frac(cft) ==
         "0c000c0000005e0000008e00000000510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000");
   CHECK(frac(bft) ==
         "0c000c0000005e0000008e00000001510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000");
   CHECK(json(cft) ==
         R"({"data":{"CftConsensus":{"producers":[{"name":"prod","auth":{"service":"verify-sig","rawData":"040506"}},{"name":"prod2","auth":{"service":"","rawData":""}}]}},"services":[{"codeNum":"verify-sig","codeHash":"404142434445464748494A4B4C4D4E4F505152535455565758595A5B5C5D5E5F","vmType":1,"vmVersion":2}],"wasmConfig":{"numExecutionMemories":3,"vmOptions":{"max_mutable_global_bytes":1024,"max_pages":512,"max_table_elements":8192,"max_stack_bytes":1048576}}})");
   CHECK(json(bft) ==
         R"({"data":{"BftConsensus":{"producers":[{"name":"prod","auth":{"service":"verify-sig","rawData":"040506"}},{"name":"prod2","auth":{"service":"","rawData":""}}]}},"services":[{"codeNum":"verify-sig","codeHash":"404142434445464748494A4B4C4D4E4F505152535455565758595A5B5C5D5E5F","vmType":1,"vmVersion":2}],"wasmConfig":{"numExecutionMemories":3,"vmOptions":{"max_mutable_global_bytes":1024,"max_pages":512,"max_table_elements":8192,"max_stack_bytes":1048576}}})");
   roundTrips(cft);
   roundTrips(bft);
   CHECK(frac(psibase::JointConsensus{cft, psibase::PendingConsensus{bft, 9}}) ==
         "080008000000b80000000c000c0000005e0000008e00000000510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000080008000000090000000c000c0000005e0000008e00000001510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000");
   CHECK(frac(psibase::JointConsensus{cft, std::nullopt}) ==
         "0400040000000c000c0000005e0000008e00000000510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000");

   psibase::ActionTrace inner;
   inner.action    = pinnedAction();
   inner.totalTime = std::chrono::nanoseconds{77};
   psibase::ActionTrace trace;
   trace.action      = pinnedAction();
   trace.rawRetval   = {1};
   trace.innerTraces = {{psibase::ConsoleTrace{"hello"}}, {inner}};
   trace.totalTime   = std::chrono::nanoseconds{1234};
   CHECK(frac(trace) ==
         "1400140000003500000036000000d2040000000000001c0000b82a1b83aedf0400342d8afa07a40d7ac61600000000000400000003000000010203010000000108000000080000001e000000040004000000000f0000000400040000000500000068656c6c6f040004000000013b00000014001400000000000000000000004d000000000000001c0000b82a1b83aedf0400342d8afa07a40d7ac61600000000000400000003000000010203");
   CHECK(json(trace) ==
         R"({"action":{"sender":"alice","service":"tokens","method":"credit","rawData":"010203"},"rawRetval":"01","innerTraces":[{"inner":{"ConsoleTrace":{"console":"hello"}}},{"inner":{"ActionTrace":{"action":{"sender":"alice","service":"tokens","method":"credit","rawData":"010203"},"rawRetval":"","innerTraces":[],"totalTime":"77","error":null}}}],"totalTime":"1234","error":null})");
   trace.error = "boom";
   CHECK(frac(trace) ==
         "180018000000390000003a000000d2040000000000009a0000001c0000b82a1b83aedf0400342d8afa07a40d7ac61600000000000400000003000000010203010000000108000000080000001e000000040004000000000f0000000400040000000500000068656c6c6f040004000000013b00000014001400000000000000000000004d000000000000001c0000b82a1b83aedf0400342d8afa07a40d7ac6160000000000040000000300000001020304000000626f6f6d");
   CHECK(json(psibase::TransactionTrace{{trace}, "boom"}) ==
         R"({"actionTraces":[{"action":{"sender":"alice","service":"tokens","method":"credit","rawData":"010203"},"rawRetval":"01","innerTraces":[{"inner":{"ConsoleTrace":{"console":"hello"}}},{"inner":{"ActionTrace":{"action":{"sender":"alice","service":"tokens","method":"credit","rawData":"010203"},"rawRetval":"","innerTraces":[],"totalTime":"77","error":null}}}],"totalTime":"1234","error":"boom"}],"error":"boom"})");
}

TEST_CASE("psibase records: native table rows", "[canonical][records]")
{
   psibase::StatusRow status;
   status.chainId   = digest(0x60);
   status.current   = pinnedHeader(false);
   status.head      = psibase::BlockInfo{pinnedHeader(false)};
   status.consensus = {pinnedConsensus(false), std::nullopt};
   CHECK(frac(status) ==
         "2c00606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f0c000000a6000000660100009c00101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f07000000c016c2c1da600600007185b64f77d70b0300000005000000202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f240024000000000000071156a1302cb94422c0b8d0658e4f7e477b6510305d47d9b3fd1e82e49c00101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f07000000c016c2c1da600600007185b64f77d70b0300000005000000202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f0400040000000c000c0000005e0000008e00000000510000000400040000000800000008000000270000000c00007185b64f77d70b040000000c00004a3347810e700e04000000030000000405060c00004843fa5b77d70b040000000c0000000000000000000000000004000000040000002a00004a3347810e700e404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f010208000300000004000000100000040000000200000020000000001000");
   CHECK(fnv(json(status)) == 0xd48e387a216ee961ull);

   psibase::CodeRow code{AccountNumber{"tokens"}, 3, digest(0x70), 1, 2};
   CHECK(frac(code) ==
         "320000342d8afa07a40d0300000000000000707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f0102");
   CHECK(key(code) ==
         "0da407fa8a2d34000000000000000003707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f0102");
   CHECK(json(code) ==
         R"({"codeNum":"tokens","flags":"3","codeHash":"707172737475767778797A7B7C7D7E7F808182838485868788898A8B8C8D8E8F","vmType":1,"vmVersion":2})");
   CHECK(key(code.key()) == "0002000da407fa8a2d3400");

   psibase::KvResourceKey resource{AccountNumber{"tokens"}, 1};
   CHECK(frac(resource) == "00342d8afa07a40d01000000");
   CHECK(key(resource) == "0da407fa8a2d340000000001");
   static_assert(psio1::reflect<psibase::KvResourceKey>::definitionWillNotChange);
}

TEST_CASE("psibase records: a table row with secondary keys", "[canonical][records]")
{
   using UserService::NftRecord;
   const NftRecord row{42, AccountNumber{"alice"}, AccountNumber{"bob"}};
   CHECK(frac(row) ==
         "14002a00000000b82a1b83aedf040029a41b0b345e05");
   CHECK(json(row) ==
         R"({"id":42,"issuer":"alice","owner":"bob"})");
   CHECK(key(row) ==
         "0000002a04dfae831b2ab800055e340b1ba42900");
   CHECK(key(row.id) == "0000002a");
   CHECK(key(NftRecord::ByOwner{}(row)) ==
         "055e340b1ba4290004dfae831b2ab8000000002a");
   CHECK(key(NftRecord::ByIssuer{}(row)) ==
         "04dfae831b2ab800055e340b1ba429000000002a");
   CHECK(std::string_view{psio1::get_type_name<UserService::NftTable>()} == "NftTable");
   CHECK(fnv(schemaOf<NftRecord>("NftRecord")) == 0x97b4514132f29edbull);
   roundTrips(row);
}

TEST_CASE("psibase records: an event", "[canonical][records]")
{
   using History = UserService::Nft::Events::History;
   using Payload = psio1::make_param_value_tuple<decltype(&History::ownerChange)>::type;
   static_assert(std::is_same_v<Payload, std::tuple<std::uint32_t, std::uint8_t, AccountNumber,
                                                   AccountNumber, psibase::Memo>>);
   const Payload payload{42, 1, AccountNumber{"alice"}, AccountNumber{"bob"}, psibase::Memo{"hi"}};
   CHECK(frac(payload) ==
         "19002a0000000100b82a1b83aedf040029a41b0b345e0504000000020000006869");
   CHECK(json(payload) == R"([42,1,"alice","bob","hi"])");
   CHECK(std::string_view{psio1::get_type_name<History>()} == "Nft_EventsHistory");
   const auto names = psio1::reflect<History>::member_function_names[0];
   CHECK(std::vector<std::string_view>(names.begin(), names.end()) ==
         std::vector<std::string_view>{"ownerChange", "nftId", "action", "account",
                                       "counter_party", "memo"});
}

namespace glue
{
   struct RecordsRoot
   {
      psibase::BlockHeader   header;
      UserService::NftRecord nft;
      PSIO1_REFLECT(RecordsRoot, header, nft)
   };
}  // namespace glue

TEST_CASE("psibase records: GraphQL", "[canonical][records]")
{
   RecordsRoot root{pinnedHeader(true), {42, AccountNumber{"alice"}, AccountNumber{"bob"}}};
   CHECK(psio1::gql_query(root,
                          "{ nft { id issuer owner } header { blockNum producer time term "
                          "newConsensus { wasmConfig { numExecutionMemories } "
                          "services { codeNum vmType } } } }",
                          "") ==
         R"({"data": {"nft":{"id":42,"issuer":"alice","owner":"bob"},"header":{"blockNum":7,"producer":"prod","time":"2026-11-22T10:15:30.123456Z","term":3,"newConsensus":{"wasmConfig":{"numExecutionMemories":3},"services":[{"codeNum":"verify-sig","vmType":1}]}}}})");
}
