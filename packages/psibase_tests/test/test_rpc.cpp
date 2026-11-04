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
      SECTION("unknown extension with comma")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for=192.168.0.1;comment=",")"}}};
         IPV4Address expected1{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected1});
      }
      SECTION("unknown extension with semi")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(comment=";for=wrong";for=192.168.0.1)"}}};
         IPV4Address expected1{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected1});
      }
      SECTION("invalid extension")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(comment=a:b;for=192.168.0.1)"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("mismatched quote in extension")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for=192.168.0.1;comment=a")"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("duplicate parameter")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(for=192.168.0.1;for=127.0.0.1)"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
      SECTION("case-insensitive")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(FoR=192.168.0.1)"}}};
         IPV4Address expected{192, 168, 0, 1};
         CHECK(forwardedFor(request) == R{expected});
      }
      SECTION("case-insensitive duplicate")
      {
         HttpRequest request{.headers = {{"Forwarded", R"(FoR=192.168.0.1;comment=1;COMMENT=2)"}}};
         CHECK(forwardedFor(request) == R{std::nullopt});
      }
   }
}

TEST_CASE("Test QSplit")
{
   auto split = [](std::string_view s)
   {
      std::vector<std::string_view> result;
      for (std::string_view item : QSplit{s, ','})
      {
         result.push_back(item);
      }
      return result;
   };
   using V = std::vector<std::string_view>;
   CHECK(split({}) == V{""});
   CHECK(split("") == V{""});
   CHECK(split(" a ") == V{" a "});
   CHECK(split(",") == V{"", ""});
   CHECK(split(R"(",")") == V{R"(",")"});
   CHECK(split(R"("\",a")") == V{R"("\",a")"});
   CHECK(split(R"("\\",a")") == V{R"("\\")", R"(a")"});
   CHECK(split(R"(",", a )") == V{R"(",")", " a "});
   CHECK(std::ranges::equal(QSplit{"a,b,c", ','}, V{"a", "b", "c"}));
}

TEST_CASE("acceptWeight")
{
   auto weight = [](std::vector<std::string> accept)
   {
      HttpHeaders headers;
      for (auto& value : accept)
         headers.push_back({"Accept", std::move(value)});
      return acceptWeight(headers, "text", "html");
   };
   CHECK(weight({}) == 0);
   CHECK(weight({""}) == 0);
   CHECK(weight({"text/html"}) == 1000);
   CHECK(weight({"TEXT/Html"}) == 1000);
   CHECK(weight({"text/plain"}) == 0);
   CHECK(weight({"*/*"}) == 1000);
   CHECK(weight({"text/*;q=0.5"}) == 500);
   CHECK(weight({"text/html;q=0"}) == 0);
   CHECK(weight({"text/html ; Q=0.25"}) == 250);
   CHECK(weight({"text/html;q=0.05"}) == 50);
   CHECK(weight({"text/html;q=1.000"}) == 1000);
   CHECK(weight({"text/html;level=1;q=0.3"}) == 300);
   CHECK(weight({R"(text/html;foo=";q=0";q=0.3)"}) == 300);
   CHECK(weight({R"(text/html;q=0.3;foo=";q=0")"}) == 300);

   SECTION("malformed weights count as 0")
   {
      for (auto q : {"2", "1.5", "0.0001", "0.x", ".5", "", "-0"})
      {
         CHECK(weight({"text/html;q="s + q}) == 0);
      }
      CHECK(weight({"text/html;Q=x, */*"}) == 0);
   }

   SECTION("the most specific range applies")
   {
      CHECK(weight({"text/html;q=0, */*"}) == 0);
      CHECK(weight({"*/*, text/*;q=0.2, text/html;q=0.7"}) == 700);
      CHECK(weight({"*/*;q=0.1, text/*;q=0.2"}) == 200);
      CHECK(weight({"text/*;q=0.2", "text/html;q=0.6"}) == 600);
   }

   SECTION("browser navigation")
   {
      HttpHeaders headers{
          {"Accept",
           "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,"
           "image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"}};
      CHECK(acceptWeight(headers, "text", "html") == 1000);
      CHECK(acceptWeight(headers, "text", "plain") == 800);
   }
}
