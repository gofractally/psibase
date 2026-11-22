// PSIO as psibase acquires it: the same headers natively and in a WASM guest
// (no exceptions, no simdjson). Every format psibase uses is exercised on one
// record: PSSZ, key, I-JSON and the schema IR.
#include <catch2/catch_all.hpp>

#include <psio/json.hpp>
#include <psio/key.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_ir.hpp>
#include <psio/pssz_ir_json.hpp>
#include <psio/schema_builder.hpp>

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace psio_acquisition
{
   struct Fixed
   {
      std::uint32_t a = 0;
      std::uint64_t b = 0;
      friend bool   operator==(const Fixed&, const Fixed&) = default;
      PSIO_REFLECT(Fixed, definitionWillNotChange(), a, b)
   };

   struct Record
   {
      Fixed                        fixed;
      std::string                  text;
      std::vector<std::uint16_t>   list;
      std::optional<std::uint64_t> appended;
      friend bool                  operator==(const Record&, const Record&) = default;
   };
   PSIO_REFLECT(Record, fixed, text, list, appended)

   std::string hex(std::span<const char> bytes)
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
}  // namespace psio_acquisition

using namespace psio_acquisition;

TEST_CASE("PSIO: the configured build profile")
{
#ifdef COMPILING_WASM
   // Guests: header-only, hand-written JSON lexer, no exception helpers.
   CHECK(PSIO_HAVE_SIMDJSON == 0);
   CHECK(PSIO_EXCEPTIONS_ENABLED == 0);
#else
   CHECK(PSIO_HAVE_SIMDJSON == 1);
   CHECK(PSIO_EXCEPTIONS_ENABLED == 1);
#endif
}

TEST_CASE("PSIO: PSSZ round trip, validation and exact bytes")
{
   const Fixed fixed{0x01020304, 0x1112131415161718ull};
   const auto  fixedBytes = psio::encode(psio::pssz{}, fixed);
   // A fixed-layout record is its members, little-endian, with no header.
   CHECK(hex(fixedBytes) == "040302011817161514131211");
   REQUIRE(psio::validate<Fixed>(psio::pssz{}, std::span<const char>{fixedBytes}).ok());
   CHECK(psio::decode<Fixed>(psio::pssz{}, std::span<const char>{fixedBytes}) == fixed);

   const Record value{fixed, "psibase", {1, 2, 3}, 7};
   const auto   bytes = psio::encode(psio::pssz{}, value);
   REQUIRE(psio::validate<Record>(psio::pssz{}, std::span<const char>{bytes}).ok());
   CHECK(psio::decode<Record>(psio::pssz{}, std::span<const char>{bytes}) == value);

   // Truncated input is rejected, never read out of bounds.
   for (std::size_t n = 0; n < bytes.size(); ++n)
      CHECK_FALSE(psio::validate<Record>(psio::pssz{}, std::span<const char>{bytes.data(), n}).ok());
}

TEST_CASE("PSIO: key bytes sort like the value")
{
   const auto low  = psio::to_key(Fixed{1, 0x0100});
   const auto high = psio::to_key(Fixed{1, 0x0001'0000});
   CHECK(hex(low) == "000000010000000000000100");
   CHECK(hex(high) == "000000010000000000010000");
   CHECK(std::string_view{low.data(), low.size()} < std::string_view{high.data(), high.size()});
   REQUIRE(psio::validate<Fixed>(psio::key{}, std::span<const char>{low}).ok());
   CHECK(psio::decode<Fixed>(psio::key{}, std::span<const char>{low}) == Fixed{1, 0x0100});
}

TEST_CASE("PSIO: I-JSON text in both directions")
{
   const Record value{{1, 18446744073709551615ull}, "psibase", {1, 2}, std::nullopt};
   std::string  text;
   REQUIRE(psio::encode_json_checked(psio::ijson{}, value, text).ok());
   // 64-bit integers beyond 2^53 - 1 are strings under I-JSON.
   CHECK(text ==
         R"({"fixed":{"a":1,"b":"18446744073709551615"},"text":"psibase","list":[1,2],"appended":null})");
   Record back;
   REQUIRE(psio::decode_json_checked(psio::ijson{}, std::span<const char>{text}, back).ok());
   CHECK(back == value);

   const std::string bad = R"({"fixed":{"a":1,"b":18446744073709551615},"text":"","list":[]})";
   CHECK_FALSE(psio::validate_json<Record>(psio::ijson{}, std::span<const char>{bad}).ok());
}

TEST_CASE("PSIO: schema IR drives the same bytes and text")
{
   namespace ir      = psio::pssz_ir;
   const auto schema = psio::SchemaBuilder{}.insert<Record>("Record").build();
   const psio::schema_types::AnyType root{psio::schema_types::Type{"Record"}};

   const Record value{{5, 6}, "x", {9}, 1};
   const auto   bytes = psio::encode(psio::pssz{}, value);
   REQUIRE(ir::validate_pssz(schema, root, std::span<const char>{bytes}).ok());

   std::string typed;
   REQUIRE(psio::encode_json_checked(psio::ijson{}, value, typed).ok());
   std::string dynamic;
   REQUIRE(ir::pssz_to_json(schema, root, psio::ijson{}, std::span<const char>{bytes}, dynamic).ok());
   CHECK(dynamic == typed);

   std::vector<char> packed;
   REQUIRE(ir::json_to_pssz(schema, root, psio::ijson{}, std::span<const char>{typed}, packed).ok());
   CHECK(packed == bytes);
}
