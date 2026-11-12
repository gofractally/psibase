#include <psibase/DefaultTestChain.hpp>
#include <services/local/XPackages.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{
   constexpr std::string_view adminOrigin = "https://x-admin.psibase.io";

   HttpRequestBuilder nonAdminClient()
   {
      return HttpRequestBuilder{XPackages::service}.header("X-Forwarded-For", "203.0.113.5");
   }
}  // namespace

TEST_CASE("XPackages preflight allows x-admin credentials")
{
   DefaultTestChain t;
   auto             reply =
       t.http(nonAdminClient().header("Origin", adminOrigin).request("OPTIONS", "/preinstall"));
   CHECK(reply.status == HttpStatus::ok);
   CHECK(reply.getHeader("Access-Control-Allow-Origin") == adminOrigin);
   CHECK(reply.getHeader("Access-Control-Allow-Credentials") == "true");
   CHECK(reply.getHeader("Access-Control-Allow-Headers") == "Content-Type, Authorization");
}

TEST_CASE("XPackages manifest preflight allows x-admin credentials")
{
   DefaultTestChain t;
   auto             reply = t.http(nonAdminClient()
                                       .header("Origin", adminOrigin)
                                       .header("Access-Control-Request-Method", "PUT")
                                       .request("OPTIONS", "/manifest/ABCD"));
   CHECK(reply.status == HttpStatus::ok);
   CHECK(reply.getHeader("Access-Control-Allow-Origin") == adminOrigin);
   CHECK(reply.getHeader("Access-Control-Allow-Credentials") == "true");
   CHECK(reply.getHeader("Access-Control-Allow-Headers") == "Content-Type, Authorization");
}
