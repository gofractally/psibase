#include <psibase/DefaultTestChain.hpp>
#include <services/local/BasicAuth.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XBasic.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace psibase;
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
   DefaultTestChain t;

   auto table = XBasic{}.open<PasswordTable>();
   table.put({"Aladdin", "$2b$05$fq6gX6Ze3Zb0MMmK8.DSge0.M47/V079Lxbre9k0L5snzcEIp1LXy"});

   auto req = HttpRequestBuilder{}.get(XAdmin::service, "/config");
   req.headers.push_back({"X-Forwarded-For", "192.168.0.1"});
   SECTION("No auth")
   {
      auto reply = t.http(req);
      CHECK(reply.status == HttpStatus::unauthorized);
   }
   SECTION("valid password")
   {
      req.headers.push_back({"Authorization", "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="});
      for (std::size_t i = 0; i < 4; ++i)
      {
         auto reply = t.http(req);
         CHECK(reply.status == HttpStatus::ok);
      }
   }
   SECTION("wrong user")
   {
      req.headers.push_back({"Authorization", "Basic QWxpIEJhYmE6b3BlbiBzZXNhbWU="});
      for (std::size_t i = 0; i < 4; ++i)
      {
         auto reply = t.http(req);
         CHECK(reply.status == HttpStatus::unauthorized);
      }
   }
   SECTION("wrong password")
   {
      req.headers.push_back({"Authorization", "Basic QWxhZGRpbjpzd29yZGZpc2g="});
      for (std::size_t i = 0; i < 4; ++i)
      {
         auto reply = t.http(req);
         CHECK(reply.status == HttpStatus::unauthorized);
      }
   }
}
