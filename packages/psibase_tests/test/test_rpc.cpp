#include <psibase/HttpHeaders.hpp>
#include <psibase/Rpc.hpp>

#include <psibase/tester.hpp>

#include <catch2/catch_all.hpp>

using namespace std::literals::string_literals;
using namespace psibase;

namespace psibase
{
   std::ostream& operator<<(std::ostream& os, const IPV4Address& addr)
   {
      return os << to_string(addr);
   }
   std::ostream& operator<<(std::ostream& os, const IPV6Address& addr)
   {
      return os << to_string(addr);
   }
}  // namespace psibase

TEST_CASE("getCookie")
{
   HttpRequest request{.headers = {{"CooKiE", "foo=10; bar=27; session=xxx"}}};
   auto        values = request.getCookie("bar");
   CHECK(values == std::vector<std::string_view>{"27"});
}

TEST_CASE("removeCookie")
{
   HttpRequest request{.headers = {{"CooKiE", "foo=10; bar=27; bar=42; session=xxx"},
                                   {"cookie", "bar=7"},
                                   {"cookie", "bar=17; extra=9"}}};
   request.removeCookie("bar");
   CHECK(request.headers.size() == 2);
   CHECK(request.headers[0].value == "foo=10; session=xxx");
   CHECK(request.headers[1].value == "extra=9");
}

TEST_CASE("forwardedFor")
{
   using R = std::vector<std::optional<IPAddress>>;
   SECTION("X-Forwarded-For")
   {
      SECTION("v4")
      {
         HttpRequest request{.headers = {{"X-Forwarded-For", "192.168.0.1"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v6")
      {
         HttpRequest request{.headers = {{"X-Forwarded-For", "::1"}}};
         IPV6Address expected{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("comma separated")
      {
         HttpRequest request{.headers = {{"X-Forwarded-For", "192.168.0.1, ::1"}}};
         IPV4Address expected0{192, 168, 0, 1};
         IPV6Address expected1{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected0, expected1});
      }
      SECTION("multiple headers")
      {
         HttpRequest request{
             .headers = {{"X-Forwarded-For", "192.168.0.1"}, {"X-Forwarded-For", "::1"}}};
         IPV4Address expected0{192, 168, 0, 1};
         IPV6Address expected1{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected0, expected1});
      }
      SECTION("invalid")
      {
         HttpRequest request{.headers = {{"X-Forwarded-For", "asdf, ::1"}}};
         IPV6Address expected1{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{std::nullopt, expected1});
      }
   }
   SECTION("Forwarded")
   {
      SECTION("v4")
      {
         HttpRequest request{.headers = {{"Forwarded", "for=192.168.0.1"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v4:port")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="192.168.0.1:12345")"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v4:obfport")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="192.168.0.1:_12345")"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v6")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="[::1]")"}}};
         IPV6Address expected{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v6 missing quote")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for=[::1])"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("v6:port")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="[::1]:12345")"}}};
         IPV6Address expected{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("v6:obfport")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="[::1]:_12345")"}}};
         IPV6Address expected{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("comma separated")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for=192.168.0.1, for="[::1]")"}}};
         IPV4Address expected0{192, 168, 0, 1};
         IPV6Address expected1{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected0, expected1});
      }
      SECTION("multiple headers")
      {
         HttpRequest request{
             .headers = {{"Forwarded", "for=192.168.0.1"}, {"Forwarded", R"(for="[::1]")"}}};
         IPV4Address expected0{192, 168, 0, 1};
         IPV6Address expected1{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
         CHECK(forwardedFor(request) == R{expected0, expected1});
      }
      SECTION("other fields")
      {
         HttpRequest request{.headers = {{"Forwarded", "by=127.0.0.1;for=192.168.0.1;proto=http"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("invalid")
      {
         HttpRequest request{.headers = {{"Forwarded", "for=asdf,for=192.168.0.1"}}};
         IPV4Address expected1{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{std::nullopt, expected1});
      }
      SECTION("v4:invalid")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="192.168.0.1:err")"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("invalid obfport")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="192.168.0.1:_err$")"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("v6:invalid")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for="[::1]:err")"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("obf")
      {
         HttpRequest request{.headers = {{"Forwarded", "for=_asdf,for=192.168.0.1"}}};
         IPV4Address expected1{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{std::nullopt, expected1});
      }
      SECTION("unknown")
      {
         HttpRequest request{.headers = {{"Forwarded", "for=unknown,for=192.168.0.1"}}};
         IPV4Address expected1{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{std::nullopt, expected1});
      }
   }
}
