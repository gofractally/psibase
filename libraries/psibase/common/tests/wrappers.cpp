// The psibase types that are more than a plain record, as PSIO sees them:
// transparent wrappers with an invariant (Memo, Precision; key material and
// the XAdmin authentication results without one), a record with a text form
// (Decimal), rows with a monotonic time point, a record with a map member.
//
// What is checked here is the PSIO form (PSSZ, key, I-JSON, validation). The
// bytes psibase puts on the wire today are still the legacy library's; they
// are pinned in libraries/psio1/tests/canonical_glue_tests.cpp.
#include <psibase/Memo.hpp>
#include <psibase/nativeTables.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XTimer.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/user/DynLd.hpp>
#include <services/user/tokenTypes.hpp>

#include <psio/helpers.hpp>
#include <psio/json.hpp>
#include <psio/key.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>

#include <catch2/catch_all.hpp>

#include <exception>
#include <limits>
#include <map>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace
{
   template <typename Bytes>
   std::string hex(const Bytes& bytes)
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
   std::string pssz(const T& v)
   {
      return hex(psio::to_pssz(v));
   }
   template <typename T>
   std::string key(const T& v)
   {
      return hex(psio::to_key(v));
   }
   template <typename T>
   bool readsJson(std::string_view text)
   {
      T out{};
      return psio::decode_json_checked(psio::ijson{}, text, out).ok();
   }
   std::vector<char> bytesOf(std::string_view hexText)
   {
      std::vector<char> out;
      auto              nibble = [](char c) { return c <= '9' ? c - '0' : c - 'a' + 10; };
      for (std::size_t i = 0; i + 1 < hexText.size(); i += 2)
         out.push_back(static_cast<char>(nibble(hexText[i]) << 4 | nibble(hexText[i + 1])));
      return out;
   }

   using psibase::AccountNumber;
   using psibase::Memo;
   using psibase::MethodNumber;
   using UserService::Decimal;
   using UserService::Precision;
   using UserService::Quantity;

   // Decimal with the precision spelled as the integer it is.
   struct PlainDecimal
   {
      Quantity     quantity;
      std::uint8_t precision = 0;
      PSIO_REFLECT(PlainDecimal, quantity, precision)
   };
}  // namespace

static_assert(psio::is_transparent_v<Memo> && psio::has_invariant_v<Memo>);
static_assert(psio::is_transparent_v<Precision> && psio::has_invariant_v<Precision>);
static_assert(psio::is_transparent_v<LocalService::Auth::Account>);
static_assert(psio::is_transparent_v<LocalService::Auth::LocalUsername>);
static_assert(psio::is_transparent_v<SystemService::AuthSig::PrivateKeyInfo>);
static_assert(psio::has_adapter_v<Decimal, psio::text_category>);
static_assert(psio::Reflected<psibase::TimerRow> && psio::Reflected<LocalService::TimerQueueRow> &&
              psio::Reflected<UserService::DynDepGroups>);

TEST_CASE("Memo: it is its text in PSSZ, key and I-JSON", "[wrappers]")
{
   const Memo        memo{"h\xc3\xa9llo"};
   const std::string text{"h\xc3\xa9llo"};
   CHECK(psio::to_pssz(memo) == psio::to_pssz(text));
   CHECK(key(memo) == key(text));
   CHECK(psio::to_ijson(memo) == psio::to_ijson(text));
   CHECK(psio::to_ijson(memo) == "\"h\xc3\xa9llo\"");
   CHECK(psio::from_pssz<Memo>(psio::to_pssz(memo)).contents == text);

   // In a record it takes the place of a string.
   CHECK(psio::to_pssz(std::tuple{std::uint8_t{7}, memo}) ==
         psio::to_pssz(std::tuple{std::uint8_t{7}, text}));
}

TEST_CASE("Memo: text that is not a memo is rejected by every checking reader", "[wrappers]")
{
   const std::string longText(81, 'a');
   const std::string notUtf8{"\xff\xfe"};
   CHECK(psio::validate_pssz<Memo>(psio::to_pssz(std::string(80, 'a'))).ok());
   CHECK(!psio::validate_pssz<Memo>(psio::to_pssz(longText)).ok());
   CHECK(!psio::validate_pssz<Memo>(psio::to_pssz(notUtf8)).ok());
   CHECK(std::string_view{psio::validate_pssz<Memo>(psio::to_pssz(longText)).error().what} ==
         "Memo exceeds 80 bytes");
   CHECK(std::string_view{psio::validate_pssz<Memo>(psio::to_pssz(notUtf8)).error().what} ==
         "Memo must be valid UTF-8");
   // inside a record too
   using Args = std::tuple<std::uint32_t, Memo>;
   CHECK(psio::validate_pssz<Args>(psio::to_pssz(std::tuple{std::uint32_t{1}, std::string{"ok"}}))
             .ok());
   CHECK(!psio::validate_pssz<Args>(psio::to_pssz(std::tuple{std::uint32_t{1}, longText})).ok());

   CHECK(readsJson<Memo>("\"hello\""));
   CHECK(!readsJson<Memo>("\"" + longText + "\""));
   CHECK(!readsJson<Memo>("{\"contents\":\"hello\"}"));
}

TEST_CASE("Precision: it is its number, 0 to 8", "[wrappers]")
{
   const Precision p{4};
   CHECK(pssz(p) == "04");
   CHECK(key(p) == "04");
   CHECK(psio::to_ijson(p) == "4");
   CHECK(psio::from_pssz<Precision>(bytesOf("08")).value == 8);
   CHECK(!psio::validate_pssz<Precision>(bytesOf("09")).ok());
   CHECK(readsJson<Precision>("8"));
   CHECK(!readsJson<Precision>("9"));
   // The rejection names the number.
   {
      const auto status = psio::validate_pssz<Precision>(bytesOf("09"));
      REQUIRE(!status.ok());
      CHECK(status.error().what == "Value 9 outside allowed Precision range: 0 to 8");
      Precision  out;
      const auto read = psio::decode_json_checked(psio::ijson{}, std::string_view{"200"}, out);
      REQUIRE(!read.ok());
      CHECK(read.error().what == "Value 200 outside allowed Precision range: 0 to 8");
   }
}

TEST_CASE("Decimal: a record whose text is the decimal number", "[wrappers]")
{
   const Decimal d{Quantity{std::uint64_t{1234567}}, Precision{4}};
   // The record (quantity, precision); the precision in it is its number.
   CHECK(pssz(d) == pssz(PlainDecimal{Quantity{std::uint64_t{1234567}}, 4}));
   REQUIRE(psio::validate_pssz<Decimal>(psio::to_pssz(d)).ok());
   CHECK(psio::from_pssz<Decimal>(psio::to_pssz(d)).str() == "123.4567");
   CHECK(!psio::validate_pssz<Decimal>(
              psio::to_pssz(PlainDecimal{Quantity{std::uint64_t{1}}, 9}))
              .ok());
   CHECK(psio::to_ijson(d) == "\"123.4567\"");
   {
      Decimal back;
      REQUIRE(psio::decode_json_checked(psio::ijson{}, std::string_view{"\"0.50\""}, back).ok());
      CHECK(back.quantity.value == 50);
      CHECK(back.precision.value == 2);
   }

   auto reads  = [](std::string_view s) { return Decimal::parse(s).has_value(); };
   auto strict = [](std::string_view s)
   {
      return UserService::DecimalText::validate_strict(std::span<const char>{s.data(), s.size()})
          .ok();
   };
   // every spelling Decimal::fromStr reads
   for (std::string_view s : {"0", "40000", "400.00", "0.12345678", ".5", "5.", "007.10",
                              "18446744073709551615", "184467440737.09551615"})
   {
      INFO(s);
      CHECK(reads(s));
      CHECK(Decimal::parse(s)->quantity.value == Decimal::fromStr(s).quantity.value);
      CHECK(Decimal::parse(s)->precision.value == Decimal::fromStr(s).precision.value);
   }
   // and nothing else
   for (std::string_view s : {"", ".", "1.2.3", "-1", "+1", "1e3", " 1", "1 ", "0.123456789",
                              "18446744073709551616", "184467440737.09551616", "1844674407371.00000000"})
   {
      INFO(s);
      CHECK(!reads(s));
   }
   // one spelling per value
   CHECK(strict("0"));
   CHECK(strict("0.50"));
   CHECK(strict("123.4567"));
   CHECK(!strict(".5"));
   CHECK(!strict("5."));
   CHECK(!strict("007.10"));
   CHECK(!readsJson<Decimal>("\"1.2.3\""));
   CHECK(!readsJson<Decimal>("{\"quantity\":1,\"precision\":0}"));
}

TEST_CASE("Decimal: a quantity that does not fit 64 bits is rejected, not wrapped", "[wrappers]")
{
   constexpr std::uint64_t max = std::numeric_limits<std::uint64_t>::max();
   struct Boundary
   {
      std::uint8_t     precision;
      std::string_view largest;  // 2^64 - 1 at this precision
      std::string_view next;     // 2^64: one unit more
   };
   const Boundary boundaries[] = {
       {0, "18446744073709551615", "18446744073709551616"},
       {1, "1844674407370955161.5", "1844674407370955161.6"},
       {2, "184467440737095516.15", "184467440737095516.16"},
       {4, "1844674407370955.1615", "1844674407370955.1616"},
       {7, "1844674407370.9551615", "1844674407370.9551616"},
       {8, "184467440737.09551615", "184467440737.09551616"},
   };
   auto validates = [](std::string_view s)
   {
      return UserService::DecimalText::validate(std::span<const char>{s.data(), s.size()}).ok();
   };
   auto quoted = [](std::string_view s) { return "\"" + std::string(s) + "\""; };
   for (const auto& b : boundaries)
   {
      INFO(b.largest);
      // the largest quantity is read, by every reader, as itself
      CHECK(Decimal{Quantity{max}, Precision{b.precision}}.str() == b.largest);
      REQUIRE(Decimal::parse(b.largest).has_value());
      CHECK(Decimal::parse(b.largest)->quantity.value == max);
      CHECK(Decimal::parse(b.largest)->precision.value == b.precision);
      CHECK(Decimal::fromStr(b.largest).quantity.value == max);
      CHECK(Decimal::fromStr(b.largest).precision.value == b.precision);
      CHECK(validates(b.largest));
      CHECK(readsJson<Decimal>(quoted(b.largest)));
      // one more is not a Decimal
      CHECK(!Decimal::parse(b.next).has_value());
      CHECK(!validates(b.next));
      CHECK(!readsJson<Decimal>(quoted(b.next)));
#ifndef COMPILING_WASM
      // fromStr aborts (an exception natively) instead of wrapping to 0
      std::string message;
      try
      {
         (void)Decimal::fromStr(b.next);
      }
      catch (std::exception& e)
      {
         message = e.what();
      }
      CHECK(message ==
            (b.precision == 0 ? "Invalid number: parse error" : "Invalid number: overflow"));
#endif
   }
   // further out: the integer part alone, or a carry out of the fraction
   for (std::string_view s : {"184467440738.00000000", "184467440737.99999999",
                              "1844674407370955162.0", "99999999999999999999.9"})
   {
      INFO(s);
      CHECK(!Decimal::parse(s).has_value());
      CHECK(!validates(s));
      CHECK(!readsJson<Decimal>(quoted(s)));
   }
   // the packed form has no such value: every 64-bit quantity is one
   CHECK(psio::validate_pssz<Decimal>(psio::to_pssz(Decimal{Quantity{max}, Precision{8}})).ok());
}

TEST_CASE("Rows with a monotonic time point: ticks, in PSSZ, key and I-JSON", "[wrappers]")
{
   const psibase::MonotonicTimePointUSec mono{psibase::MicroSeconds{123456789}};
   CHECK(pssz(mono) == "15cd5b0700000000");
   CHECK(key(mono) == "80000000075bcd15");
   CHECK(psio::to_ijson(mono) == "123456789");

   const LocalService::TimerQueueRow row{11, mono, AccountNumber{"alice"}, MethodNumber{"tick"}};
   const auto                        bytes = psio::to_pssz(row);
   REQUIRE(psio::validate_pssz<LocalService::TimerQueueRow>(bytes).ok());
   const auto back = psio::from_pssz<LocalService::TimerQueueRow>(bytes);
   CHECK(back.id == 11);
   CHECK(back.expiration == mono);
   CHECK(back.service == AccountNumber{"alice"});
   CHECK(psio::to_ijson(row) ==
         R"({"id":11,"expiration":123456789,"service":"alice","method":"tick"})");
   // the secondary key of the timer queue: (expiration, id)
   CHECK(key(std::tuple{row.expiration, row.id}) == "80000000075bcd15000000000000000b");

   const psibase::TimerRow timer{mono, AccountNumber{"x-timer"}, MethodNumber{"fire"}};
   CHECK(psio::from_pssz<psibase::TimerRow>(psio::to_pssz(timer)).expiration == mono);
}

TEST_CASE("A record with a map member", "[wrappers]")
{
   const UserService::DynDepGroups groups{
       AccountNumber{"alice"}, {{"a", {{"dep1", AccountNumber{"bob"}}}}, {"b", {}}}};
   const auto bytes = psio::to_pssz(groups);
   REQUIRE(psio::validate_pssz<UserService::DynDepGroups>(bytes).ok());
   const auto back = psio::from_pssz<UserService::DynDepGroups>(bytes);
   CHECK(back.service == AccountNumber{"alice"});
   REQUIRE(back.groups.size() == 2);
   CHECK(back.groups.at("a").at(0).name == "dep1");
   CHECK(back.groups.at("a").at(0).service == AccountNumber{"bob"});
   CHECK(back.groups.at("b").empty());
   INFO(psio::to_ijson(groups));
   UserService::DynDepGroups fromText;
   REQUIRE(psio::decode_json_checked(psio::ijson{}, psio::to_ijson(groups), fromText).ok());
   CHECK(psio::to_pssz(fromText) == bytes);
}

TEST_CASE("Transparent wrappers without an invariant", "[wrappers]")
{
   using namespace LocalService::Auth;
   CHECK(pssz(Account{AccountNumber{"alice"}}) == pssz(AccountNumber{"alice"}));
   CHECK(psio::to_ijson(Account{AccountNumber{"alice"}}) == "\"alice\"");
   CHECK(psio::to_pssz(LocalUsername{"root"}) == psio::to_pssz(std::string{"root"}));

   const SystemService::AuthSig::PrivateKeyInfo key{{0x30, 0x03, 0x02, 0x01, 0x00}};
   CHECK(psio::to_pssz(key) == psio::to_pssz(key.data));
   CHECK(psio::to_ijson(key) == "\"3003020100\"");
}
