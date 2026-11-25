// psibase's leaf value types as PSIO defines them: PSSZ bytes, key bytes and
// order, I-JSON text in both directions, the schema IR, and rejection of
// invalid input. Runs natively and in a WASM guest.
#include <catch2/catch_all.hpp>

#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>

#include <psio/json.hpp>
#include <psio/key.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_ir.hpp>
#include <psio/pssz_ir_json.hpp>
#include <psio/schema_builder.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

using namespace psibase;
namespace st = psio::schema_types;
namespace ir = psio::pssz_ir;

namespace
{
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

   std::vector<char> unhex(std::string_view text)
   {
      auto nibble = [](char c) { return c <= '9' ? c - '0' : c - 'a' + 10; };
      std::vector<char> out;
      for (std::size_t i = 0; i + 1 < text.size(); i += 2)
         out.push_back(static_cast<char>(nibble(text[i]) << 4 | nibble(text[i + 1])));
      return out;
   }

   template <typename T>
   std::string pssz(const T& value)
   {
      std::vector<char> bytes;
      REQUIRE(psio::encode_pssz_checked(psio::pssz{}, value, bytes).ok());
      REQUIRE(psio::validate<T>(psio::pssz{}, std::span<const char>{bytes}).ok());
      CHECK(psio::decode<T>(psio::pssz{}, std::span<const char>{bytes}) == value);
      return hex(bytes);
   }

   template <typename T>
   bool psszValid(std::string_view bytes)
   {
      const auto raw = unhex(bytes);
      return psio::validate<T>(psio::pssz{}, std::span<const char>{raw}).ok();
   }

   template <typename T>
   std::string key(const T& value)
   {
      const auto bytes = psio::to_key(value);
      REQUIRE(psio::validate<T>(psio::key{}, std::span<const char>{bytes}).ok());
      CHECK(psio::decode<T>(psio::key{}, std::span<const char>{bytes}) == value);
      return hex(bytes);
   }

   template <typename T>
   bool keyValid(std::string_view bytes)
   {
      const auto raw = unhex(bytes);
      return psio::validate<T>(psio::key{}, std::span<const char>{raw}).ok();
   }

   // The values in ascending order must have ascending keys.
   template <typename T>
   void checkKeyOrder(std::vector<T> values)
   {
      std::sort(values.begin(), values.end());
      for (std::size_t i = 0; i + 1 < values.size(); ++i)
      {
         const auto a = psio::to_key(values[i]);
         const auto b = psio::to_key(values[i + 1]);
         INFO(hex(a) << " < " << hex(b));
         CHECK((values[i] < values[i + 1]) ==
               std::lexicographical_compare(
                   a.begin(), a.end(), b.begin(), b.end(),
                   [](char x, char y) { return static_cast<unsigned char>(x) < static_cast<unsigned char>(y); }));
      }
   }

   template <typename T>
   std::string ijson(const T& value)
   {
      std::string text;
      REQUIRE(psio::encode_json_checked(psio::ijson{}, value, text).ok());
      T back{};
      REQUIRE(psio::decode_json_checked(psio::ijson{}, std::span<const char>{text}, back).ok());
      CHECK(back == value);
      return text;
   }

   template <typename T>
   std::optional<T> fromIjson(std::string_view text)
   {
      T value{};
      if (!psio::decode_json_checked(psio::ijson{}, std::span<const char>{text}, value).ok())
         return std::nullopt;
      // `validate` and `decode` agree on what is accepted.
      CHECK(psio::validate_json<T>(psio::ijson{}, std::span<const char>{text}).ok());
      return value;
   }

   template <typename T>
   bool ijsonRejected(std::string_view text)
   {
      T value{};
      return !psio::validate_json<T>(psio::ijson{}, std::span<const char>{text}).ok() &&
             !psio::decode_json_checked(psio::ijson{}, std::span<const char>{text}, value).ok();
   }

   // Every leaf type as a member, so that the schema and the schema-driven
   // codecs see each one in place.
   struct Leaves
   {
      AccountNumber account;
      MethodNumber  method;
      TimePointSec  sec;
      TimePointUSec usec;
      Seconds       seconds;
      MicroSeconds  micros;
      Checksum160   hash160;
      Checksum256   hash256;
      Checksum512   hash512;
      friend bool   operator==(const Leaves&, const Leaves&) = default;
   };
   PSIO_REFLECT(Leaves, account, method, sec, usec, seconds, micros, hash160, hash256, hash512)

   const st::AnyType& memberType(const st::Schema& schema, std::string_view name)
   {
      const st::AnyType root{st::Type{"Leaves"}};
      const auto&       object = std::get<st::Object>(root.resolve(schema)->value);
      for (const auto& member : object.members)
         if (member.name == name)
            return *member.type->resolve(schema);
      FAIL("no member " << name);
      return *root.resolve(schema);
   }

   template <std::size_t N>
   std::array<std::uint8_t, N> digest()
   {
      std::array<std::uint8_t, N> out;
      for (std::size_t i = 0; i < N; ++i)
         out[i] = static_cast<std::uint8_t>(0xf0 + i * 7);
      return out;
   }
}  // namespace

// ── AccountNumber ───────────────────────────────────────────────────────────

TEST_CASE("AccountNumber: PSSZ is the 64-bit value, little-endian")
{
   static_assert(psio::Reflected<AccountNumber>);
   static_assert(psio::is_dwnc_v<AccountNumber>);
   CHECK(pssz(AccountNumber{"alice"}) == "00b82a1b83aedf04");
   CHECK(pssz(AccountNumber{}) == "0000000000000000");
   CHECK(pssz(AccountNumber{AccountNumber{"alice"}, 7}) == "07b82a1b83aedf04");
   CHECK(pssz(AccountNumber{0x0102030405060708}) == "0807060504030201");
   CHECK(psio::size_of(psio::pssz{}, AccountNumber{"alice"}) == 8);

   CHECK(psszValid<AccountNumber>("00b82a1b83aedf04"));
   CHECK_FALSE(psszValid<AccountNumber>(""));
   CHECK_FALSE(psszValid<AccountNumber>("00b82a1b83aedf"));
   CHECK_FALSE(psszValid<AccountNumber>("00b82a1b83aedf0400"));
}

TEST_CASE("AccountNumber: key is the value, big-endian, and sorts like it")
{
   CHECK(key(AccountNumber{"alice"}) == "04dfae831b2ab800");
   CHECK(key(AccountNumber{}) == "0000000000000000");
   CHECK(key(AccountNumber{0x0102030405060708}) == "0102030405060708");
   CHECK_FALSE(keyValid<AccountNumber>("04dfae831b2ab8"));
   CHECK_FALSE(keyValid<AccountNumber>("04dfae831b2ab80000"));

   std::vector<AccountNumber> accounts;
   for (auto name : {"", "a", "alice", "alicf", "bob", "a-b-c", "0", "zzzzzzzzzz", "z", "transact",
                     "accounts", "alice2"})
      accounts.push_back(AccountNumber{name});
   accounts.push_back(AccountNumber{AccountNumber{"alice"}, 1});
   accounts.push_back(AccountNumber{AccountNumber{"alice"}, 255});
   accounts.push_back(AccountNumber{~std::uint64_t{0}});
   accounts.push_back(AccountNumber{0x8000000000000000ull});
   checkKeyOrder(accounts);

   // A composite key starts with the account's own key.
   const auto composite = psio::to_key(std::tuple{AccountNumber{"alice"}, std::uint32_t{7}});
   CHECK(hex(composite) == "04dfae831b2ab80000000007");
   CHECK(hex(psio::key_prefix<std::tuple<AccountNumber, std::uint32_t>>(AccountNumber{"alice"})) ==
         "04dfae831b2ab800");
}

TEST_CASE("AccountNumber: I-JSON is the name")
{
   CHECK(ijson(AccountNumber{"alice"}) == R"("alice")");
   CHECK(ijson(AccountNumber{}) == R"("")");
   CHECK(ijson(AccountNumber{"a-b-c"}) == R"("a-b-c")");
   CHECK(ijson(AccountNumber{"0"}) == R"("0")");
   CHECK(ijson(AccountNumber{"zzzzzzzzzz"}) == R"("zzzzzzzzzz")");
   CHECK(ijson(AccountNumber{AccountNumber{"alice"}, 7}) == R"("alice+7")");
   CHECK(ijson(AccountNumber{AccountNumber{"alice"}, 255}) == R"("alice+255")");
   CHECK(fromIjson<AccountNumber>(R"(  "alice"  )") == AccountNumber{"alice"});
   CHECK(fromIjson<AccountNumber>(R"("alice+7")")->subaccount() == 7);
}

TEST_CASE("AccountNumber: text that is not exactly an account's name is rejected")
{
   for (auto text : {
            R"("Alice")",        // upper case
            R"("-alice")",       // leading separator
            R"("alice-")",       // trailing separator
            R"("a--b")",         // doubled separator
            R"("abcdefghijk")",  // 11 characters
            R"("al ice")",       // outside the alphabet
            R"("al_ice")",
            R"("alice+0")",      // subaccount 0 is the account itself
            R"("alice+07")",     // not the canonical subaccount
            R"("alice+256")",    // subaccount out of range
            R"("alice+")",
            R"("alice")",   // escapes are text, and this text is fine
        })
   {
      INFO(text);
      if (std::string_view{text} == R"("alice")")
         CHECK(fromIjson<AccountNumber>(text) == AccountNumber{"alice"});
      else
         CHECK(ijsonRejected<AccountNumber>(text));
   }
   // Not a string at all.
   for (auto text : {"5", "null", "true", R"({"value":5})", R"(["alice"])", R"("alice" x)", ""})
   {
      INFO(text);
      CHECK(ijsonRejected<AccountNumber>(text));
   }
   // The adapter itself: validate is what the JSON reader applies.
   auto valid = [](std::string_view text)
   { return AccountNumberText::validate(std::span<const char>{text}).ok(); };
   CHECK(valid("alice"));
   CHECK(valid(""));
   CHECK_FALSE(valid("Alice"));
   CHECK_FALSE(valid("alice\n"));
   CHECK_FALSE(valid(std::string_view{"ali\0ce", 6}));
}

// ── MethodNumber ────────────────────────────────────────────────────────────

TEST_CASE("MethodNumber: PSSZ is the 64-bit value, little-endian")
{
   static_assert(psio::Reflected<MethodNumber>);
   static_assert(psio::is_dwnc_v<MethodNumber>);
   CHECK(pssz(MethodNumber{"transfer"}) == "41b6aa42ce000000");
   CHECK(pssz(MethodNumber{}) == "0000000000000000");
   CHECK(pssz(MethodNumber{"someVeryLongMethodNameThatHashes"}) == "65c102ee92116fad");
   CHECK(psio::size_of(psio::pssz{}, MethodNumber{"transfer"}) == 8);
   CHECK_FALSE(psszValid<MethodNumber>("41b6aa42ce0000"));
   CHECK_FALSE(psszValid<MethodNumber>("41b6aa42ce00000000"));
}

TEST_CASE("MethodNumber: key is the value, big-endian, and sorts like it")
{
   CHECK(key(MethodNumber{"transfer"}) == "000000ce42aab641");
   CHECK(key(MethodNumber{}) == "0000000000000000");
   CHECK_FALSE(keyValid<MethodNumber>("000000ce42aab6"));

   std::vector<MethodNumber> methods;
   for (auto name : {"", "transfer", "setcode", "init", "credit", "debit", "a", "z",
                     "someVeryLongMethodNameThatHashes", "startsession"})
      methods.push_back(MethodNumber{name});
   methods.push_back(MethodNumber{~std::uint64_t{0}});
   checkKeyOrder(methods);

   // (service, method): the key of a pair is the two keys in order.
   CHECK(hex(psio::to_key(std::tuple{AccountNumber{"alice"}, MethodNumber{"transfer"}})) ==
         "04dfae831b2ab800000000ce42aab641");
}

TEST_CASE("MethodNumber: I-JSON is the name")
{
   CHECK(ijson(MethodNumber{"transfer"}) == R"("transfer")");
   CHECK(ijson(MethodNumber{}) == R"("")");
   CHECK(ijson(MethodNumber{"setcode"}) == R"("setcode")");
   // A name that does not compress is written as its hash...
   CHECK(ijson(MethodNumber{"someVeryLongMethodNameThatHashes"}) == R"("#nradiemmicaayrpu")");
   // ...and read from either spelling.
   CHECK(fromIjson<MethodNumber>(R"("someVeryLongMethodNameThatHashes")") ==
         MethodNumber{"someVeryLongMethodNameThatHashes"});
   CHECK(fromIjson<MethodNumber>(R"("#nradiemmicaayrpu")") ==
         MethodNumber{"someVeryLongMethodNameThatHashes"});
   // An identifier as written in source names the same method.
   CHECK(fromIjson<MethodNumber>(R"("setCode")") == MethodNumber{"setcode"});
   CHECK(fromIjson<MethodNumber>(R"("setCode")") == MethodNumber{"setCode"});
}

TEST_CASE("MethodNumber: text that names no method is rejected")
{
   for (auto text : {
            R"("bad name")",           // outside the alphabet
            R"("a-b")",
            R"("tränsfer")",
            R"("#abc")",               // a hash form is '#' and 16 letters
            R"("#zzzzzzzzzzzzzzzz")",  // letters outside the hash alphabet
            R"("#aaaaaaaaaaaaaaab")",  // not the hash form of a hashed name
            R"("#")",
            "7",
            "null",
            R"({"value":7})",
            R"("transfer" "x")",
        })
   {
      INFO(text);
      CHECK(ijsonRejected<MethodNumber>(text));
   }
}

// ── Time ────────────────────────────────────────────────────────────────────

namespace
{
   using namespace std::chrono;
   constexpr TimePointSec  instant{Seconds{1795342530}};  // 2026-11-22T10:15:30Z
   constexpr TimePointUSec instantUSec{MicroSeconds{1795342530123456}};
}  // namespace

TEST_CASE("Time: PSSZ and key are the tick count")
{
   static_assert(instant == TimePointSec{duration_cast<Seconds>(
                                sys_days{2026y / 11 / 22}.time_since_epoch() + 10h + 15min + 30s)});
   CHECK(pssz(instant) == "c2c0026b00000000");
   CHECK(pssz(TimePointSec{Seconds{-1}}) == "ffffffffffffffff");
   CHECK(pssz(instantUSec) == "c016c2c1da600600");
   CHECK(pssz(Seconds{5}) == "0500000000000000");
   CHECK(pssz(Seconds{-5}) == "fbffffffffffffff");
   CHECK(pssz(MicroSeconds{1500000}) == "60e3160000000000");
   CHECK_FALSE(psszValid<TimePointSec>("c2c0026b000000"));
   CHECK_FALSE(psszValid<MicroSeconds>("60e316000000000000"));

   // Sign-flipped big-endian: byte order is chronological order.
   CHECK(key(instant) == "800000006b02c0c2");
   CHECK(key(TimePointSec{Seconds{-1}}) == "7fffffffffffffff");
   CHECK(key(instantUSec) == "800660dac1c216c0");
   CHECK(key(Seconds{5}) == "8000000000000005");
   CHECK(key(Seconds{-5}) == "7ffffffffffffffb");
   CHECK_FALSE(keyValid<TimePointSec>("800000006b02c0"));

   checkKeyOrder(std::vector<TimePointSec>{TimePointSec::min(), TimePointSec{Seconds{-1}},
                                           TimePointSec{}, TimePointSec{Seconds{1}}, instant,
                                           TimePointSec{Seconds{1795342531}}, TimePointSec::max()});
   checkKeyOrder(std::vector<TimePointUSec>{TimePointUSec::min(), TimePointUSec{MicroSeconds{-1}},
                                            TimePointUSec{}, instantUSec, TimePointUSec::max()});
   checkKeyOrder(std::vector<Seconds>{Seconds::min(), Seconds{-5}, Seconds{0}, Seconds{5},
                                      Seconds::max()});
   checkKeyOrder(std::vector<MicroSeconds>{MicroSeconds::min(), MicroSeconds{-1}, MicroSeconds{0},
                                           MicroSeconds{1}, MicroSeconds::max()});
}

TEST_CASE("Time: a time point is RFC 3339 text, a duration its tick count")
{
   CHECK(ijson(instant) == R"("2026-11-22T10:15:30Z")");
   CHECK(ijson(TimePointSec{}) == R"("1970-01-01T00:00:00Z")");
   CHECK(ijson(TimePointSec{Seconds{-1}}) == R"("1969-12-31T23:59:59Z")");
   CHECK(ijson(instantUSec) == R"("2026-11-22T10:15:30.123456Z")");
   CHECK(ijson(TimePointUSec{MicroSeconds{1}}) == R"("1970-01-01T00:00:00.000001Z")");

   CHECK(ijson(Seconds{5}) == "5");
   CHECK(ijson(Seconds{-5}) == "-5");
   CHECK(ijson(MicroSeconds{1500000}) == "1500000");
   // A 64-bit count beyond 2^53 - 1 is a string under I-JSON.
   CHECK(ijson(MicroSeconds{9007199254740993}) == R"("9007199254740993")");

   // Any RFC 3339 date-time is read; the offset is applied.
   CHECK(fromIjson<TimePointSec>(R"("2026-11-22t10:15:30z")") == instant);
   CHECK(fromIjson<TimePointSec>(R"("2026-11-22T12:15:30+02:00")") == instant);
   CHECK(fromIjson<TimePointSec>(R"("2026-11-22T10:15:30.000Z")") == instant);
   CHECK(fromIjson<TimePointUSec>(R"("2026-11-22T10:15:30.1234560Z")") == instantUSec);
   CHECK(fromIjson<TimePointUSec>(R"("2026-11-22T10:15:30Z")") ==
         TimePointUSec{MicroSeconds{1795342530000000}});
   CHECK(fromIjson<MicroSeconds>(R"("5")") == MicroSeconds{5});
}

TEST_CASE("Time: text that is not exactly representable is rejected")
{
   for (auto text : {
            R"("2026-11-22T10:15:30.5Z")",   // finer than seconds: never rounded
            R"("2026-11-22T10:15:60Z")",     // leap second
            R"("2026-11-22T10:15:30")",      // no offset
            R"("2026-11-22 10:15:30Z")",     // space instead of T
            R"("2026-02-30T10:15:30Z")",     // no such day
            R"("2026-13-01T00:00:00Z")",
            R"("2026-11-22T24:00:00Z")",
            R"("10000-01-01T00:00:00Z")",
            "1795342530",                    // a number is not a time point
            "null",
        })
   {
      INFO(text);
      CHECK(ijsonRejected<TimePointSec>(text));
   }
   CHECK(ijsonRejected<TimePointUSec>(R"("2026-11-22T10:15:30.1234567Z")"));
   CHECK(ijsonRejected<TimePointUSec>("1795342530123456"));
   for (auto text : {"1.5", R"("abc")", R"("1.5")", "9007199254740993", "null",
                     R"("2026-11-22T10:15:30Z")"})
   {
      INFO(text);
      CHECK(ijsonRejected<MicroSeconds>(text));
   }
   // A time point outside years 0000..9999 has no text; its bytes are fine.
   std::string out;
   CHECK_FALSE(psio::encode_json_checked(psio::ijson{}, TimePointSec::max(), out).ok());
   CHECK(pssz(TimePointSec::max()) == "ffffffffffffff7f");
}

// ── Digests ─────────────────────────────────────────────────────────────────

TEST_CASE("Digests: PSSZ and key are the bytes")
{
   const auto h160 = digest<20>();
   const auto h256 = digest<32>();
   const auto h512 = digest<64>();
   static_assert(std::is_same_v<Checksum160, std::array<std::uint8_t, 20>>);
   static_assert(std::is_same_v<Checksum256, std::array<std::uint8_t, 32>>);
   static_assert(std::is_same_v<Checksum512, std::array<std::uint8_t, 64>>);

   const std::string bytes160 = "f0f7fe050c131a21282f363d444b525960676e75";
   const std::string bytes256 = bytes160 + "7c838a91989fa6adb4bbc2c9";
   CHECK(pssz(h160) == bytes160);
   CHECK(pssz(h256) == bytes256);
   CHECK(pssz(h512).size() == 128);
   CHECK(pssz(h512).substr(0, 64) == bytes256);
   CHECK(pssz(Checksum256{}) == std::string(64, '0'));
   CHECK_FALSE(psszValid<Checksum256>(bytes256.substr(2)));
   CHECK_FALSE(psszValid<Checksum256>(bytes256 + "00"));
   CHECK_FALSE(psszValid<Checksum160>(bytes256));

   // No framing: a digest is a fixed-width key element.
   CHECK(key(h160) == bytes160);
   CHECK(key(h256) == bytes256);
   CHECK(key(h512).size() == 128);
   CHECK_FALSE(keyValid<Checksum256>(bytes256.substr(2)));
   CHECK(hex(psio::to_key(std::tuple{h160, std::uint8_t{1}})) == bytes160 + "01");

   std::vector<Checksum256> hashes{Checksum256{}, h256};
   Checksum256              high{};
   high.fill(0xff);
   hashes.push_back(high);
   Checksum256 low{};
   low[31] = 1;
   hashes.push_back(low);
   Checksum256 first{};
   first[0] = 1;
   hashes.push_back(first);
   checkKeyOrder(hashes);
}

TEST_CASE("Digests: I-JSON is one hex string")
{
   const auto        h160 = digest<20>();
   const std::string text = R"("F0F7FE050C131A21282F363D444B525960676E75")";
   CHECK(ijson(h160) == text);
   CHECK(ijson(digest<32>()) ==
         R"("F0F7FE050C131A21282F363D444B525960676E757C838A91989FA6ADB4BBC2C9")");
   CHECK(ijson(digest<64>()).size() == 130);
   // Either case is read; upper case is written.
   CHECK(fromIjson<Checksum160>(R"("f0f7fe050c131a21282f363d444b525960676e75")") == h160);

   for (auto bad : {
            R"("F0F7FE050C131A21282F363D444B525960676E")",      // 19 bytes
            R"("F0F7FE050C131A21282F363D444B525960676E7500")",  // 21 bytes
            R"("F0F7FE050C131A21282F363D444B525960676E7")",     // odd digits
            R"("G0F7FE050C131A21282F363D444B525960676E75")",    // not hex
            R"("0xF0F7FE050C131A21282F363D444B525960676E75")",
            "[240,247,254,5,12,19,26,33,40,47,54,61,68,75,82,89,96,103,110,117]",
            "null",
            "0",
        })
   {
      INFO(bad);
      CHECK(ijsonRejected<Checksum160>(bad));
   }
}

// ── Schema ──────────────────────────────────────────────────────────────────

TEST_CASE("Leaf types: the schema IR names each presentation")
{
   const auto schema = psio::SchemaBuilder{}.insert<Leaves>("Leaves").build();

   auto custom = [&](std::string_view member) -> const st::Custom&
   {
      const auto& type = memberType(schema, member);
      REQUIRE(std::holds_alternative<st::Custom>(type.value));
      return std::get<st::Custom>(type.value);
   };
   // A name: the custom id over the record that holds the 64-bit value.
   for (auto [member, id] : {std::pair{"account", "AccountNumber"}, std::pair{"method", "MethodNumber"}})
   {
      INFO(member);
      const auto& node = custom(member);
      CHECK(node.id == id);
      const auto* record = std::get_if<st::Object>(&node.type->resolve(schema)->value);
      REQUIRE(record);
      // Fixed layout: no header, no room for appended members.
      REQUIRE(record->attributes.size() == 1);
      CHECK(record->attributes[0].name == "definitionWillNotChange");
      REQUIRE(record->members.size() == 1);
      CHECK(record->members[0].name == "value");
      const auto* integer = std::get_if<st::Int>(&record->members[0].type->resolve(schema)->value);
      REQUIRE(integer);
      CHECK(integer->bits == 64);
      CHECK_FALSE(integer->isSigned);
   }
   static_assert(psio::schema_custom_v<AccountNumber>);
   static_assert(psio::schema_custom_v<MethodNumber>);
   static_assert(psio::schema_custom_id<AccountNumber>() == "AccountNumber");
   static_assert(psio::schema_custom_id<MethodNumber>() == "MethodNumber");

   // Time: PSIO's built-in presentations over the signed 64-bit tick count.
   for (auto [member, id] :
        {std::pair{"sec", "time-point-seconds"}, std::pair{"usec", "time-point-micros"},
         std::pair{"seconds", "duration-seconds"}, std::pair{"micros", "duration-micros"}})
   {
      INFO(member);
      const auto& node = custom(member);
      CHECK(node.id == id);
      const auto* integer = std::get_if<st::Int>(&node.type->resolve(schema)->value);
      REQUIRE(integer);
      CHECK(integer->bits == 64);
      CHECK(integer->isSigned);
   }

   // Digests: hex over a fixed array of N octets.
   for (auto [member, length] :
        {std::pair{"hash160", 20}, std::pair{"hash256", 32}, std::pair{"hash512", 64}})
   {
      INFO(member);
      const auto& node = custom(member);
      CHECK(node.id == "hex");
      const auto* array = std::get_if<st::Array>(&node.type->resolve(schema)->value);
      REQUIRE(array);
      CHECK(array->len == static_cast<std::uint64_t>(length));
   }
}

TEST_CASE("Leaf types: schema-driven codecs agree with the typed ones")
{
   const auto        schema = psio::SchemaBuilder{}.insert<Leaves>("Leaves").build();
   const st::AnyType root{st::Type{"Leaves"}};
   const Leaves      value{AccountNumber{"alice"}, MethodNumber{"transfer"}, instant,
                           instantUSec,            Seconds{5},               MicroSeconds{-6},
                           digest<20>(),           digest<32>(),             digest<64>()};

   std::vector<char> bytes;
   REQUIRE(psio::encode_pssz_checked(psio::pssz{}, value, bytes).ok());
   // The names and the times are inline, fixed width. The record's header is
   // one byte (the type-derived width): 1 + 8 * 6 + 20 + 32 + 64.
   CHECK(bytes.size() == 165);
   CHECK(hex(bytes).substr(0, 2 + 16 + 16) == "a4" "00b82a1b83aedf04" "41b6aa42ce000000");
   REQUIRE(psio::validate<Leaves>(psio::pssz{}, std::span<const char>{bytes}).ok());
   CHECK(psio::decode<Leaves>(psio::pssz{}, std::span<const char>{bytes}) == value);
   REQUIRE(ir::validate_pssz(schema, root, std::span<const char>{bytes}).ok());

   const std::string typed = ijson(value);
   CHECK(typed.starts_with(
       R"({"account":"alice","method":"transfer","sec":"2026-11-22T10:15:30Z",)"
       R"("usec":"2026-11-22T10:15:30.123456Z","seconds":5,"micros":-6,)"
       R"("hash160":"F0F7FE050C131A21282F363D444B525960676E75",)"));

   // The types' own text adapters are the handlers of their custom ids;
   // time and hex need none, also under a strict registry.
   ir::CustomHandlers handlers;
   handlers.add<AccountNumber>().add<MethodNumber>();
   handlers.require_all = true;
   std::string text;
   REQUIRE(ir::pssz_to_json(schema, root, psio::ijson{}, std::span<const char>{bytes}, text, nullptr,
                            &handlers)
               .ok());
   CHECK(text == typed);
   std::vector<char> packed;
   REQUIRE(ir::json_to_pssz(schema, root, psio::ijson{}, std::span<const char>{typed}, packed,
                            nullptr, psio::json_parser::automatic, &handlers)
               .ok());
   CHECK(packed == bytes);

   // With the handler registered, an invalid name is rejected through the schema too.
   std::string bad = typed;
   bad.replace(bad.find("alice"), 5, "Alice");
   packed.clear();
   CHECK_FALSE(ir::json_to_pssz(schema, root, psio::ijson{}, std::span<const char>{bad}, packed,
                                nullptr, psio::json_parser::automatic, &handlers)
                   .ok());

   // Without handlers a name is its wire type's text (the record), which
   // reads back to the same bytes.
   text.clear();
   REQUIRE(ir::pssz_to_json(schema, root, psio::ijson{}, std::span<const char>{bytes}, text).ok());
   CHECK(text.starts_with(
       R"({"account":{"value":"351191174077921280"},"method":{"value":885881747009},)"));
   packed.clear();
   REQUIRE(ir::json_to_pssz(schema, root, psio::ijson{}, std::span<const char>{text}, packed).ok());
   CHECK(packed == bytes);
}
