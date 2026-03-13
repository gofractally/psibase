#include <psibase/DefaultTestChain.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XSites.hpp>
#include <services/system/HttpServer.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_templated.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

struct TextBody
{
   static std::string contentType() { return "text/plain"; }
   std::vector<char>  body() const { return {value.begin(), value.end()}; }
   static TextBody    unpack(std::vector<char>&& data)
   {
      return {std::string{data.begin(), data.end()}};
   }
   std::string value;
};

TEST_CASE("Test XSites")
{
   DefaultTestChain t;
   auto             xsites = t.http(XSites::service);
   CHECK(xsites.put("/test", TextBody{"test"}).status == HttpStatus::ok);
   CHECK(xsites.get<TextBody>("/test").value == "test");
   CHECK(t.http().get(XHttp::service, "/test").status == HttpStatus::notFound);
   CHECK(t.http().put(HttpServer::service, "/wrong-service", TextBody{"test"}).status ==
         HttpStatus::notFound);
}
