#include <services/local/BasicAuth.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace LocalService;

TEST_CASE("header parsing")
{
   {
      auto auth = parseBasicAuth("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
      REQUIRE(auth.has_value());
      CHECK(auth->username() == "Aladdin");
      CHECK(auth->password() == "open sesame");
   }
}

TEST_CASE("Basic auth")
{
   "Aladdin:$2b$05$fq6gX6Ze3Zb0MMmK8.DSge0.M47/V079Lxbre9k0L5snzcEIp1LXy";
}
