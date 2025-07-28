#include <psibase/crypto.hpp>

#include <psio/from_json.hpp>

#include <psibase/tester.hpp>

#include <catch2/catch_all.hpp>

using namespace std::literals::string_literals;
using namespace psibase;

TEST_CASE("getCookie")
{
   HttpRequest request{.headers = {{"CooKiE", "foo=10; bar=27; session=xxx"}}};
   auto        value = request.getCookie("bar")[0];
   CHECK(!value.empty());
   CHECK(*value == "27");
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
