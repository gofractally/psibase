#include <services/system/HttpServerRequest.hpp>
#include <cstdio>

int main()
{
   using namespace psibase;
   using namespace SystemService::http_detail;
   unsigned checks = 0;
   auto require = [&](bool okay, const char* label)
   {
      ++checks;
      if (!okay) { std::fprintf(stderr, "FAILED: %s\n", label); std::abort(); }
   };
   HttpRequest request{.headers = {{"Cookie", "theme=dark; __Host-SESSION=secret; local=1"},
                                   {"cOoKiE", "__Host-SESSION=duplicate; SESSION=old; session=app"},
                                   {"COOKIE", "__HOST-SESSION=legacy"},
                                   {"Authorization", "Bearer sensitive"},
                                   {"aUtHoRiZaTiOn", "Bearer duplicate"},
                                   {"X-App", "preserved"}}};
   stripAuthenticationHeaders(request);
   require(request.headers.size() == 3, "only ordinary headers remain");
   require(request.headers[0].value == "theme=dark; local=1", "ordinary cookies preserved");
   require(request.headers[1].value == "session=app", "lowercase app session preserved");
   require(request.headers[2].name == "X-App", "custom app header preserved");
   require(!request.getHeader("authorization"), "every Authorization header removed");
   for (auto name : {"__Host-SESSION", "__HOST-SESSION", "SESSION"})
      require(request.getCookie(name).empty(), "reserved cookie removed");
   stripAuthenticationHeaders(request);
   require(request.headers.size() == 3, "sanitization idempotent");
   HttpRequest whitespace{.headers = {{"cookie", "\t__Host-SESSION \t=secret; app=value=with=equals"}}};
   stripAuthenticationHeaders(whitespace);
   require(whitespace.headers.size() == 1 && whitespace.headers[0].value == "app=value=with=equals",
           "whitespace cannot hide a secret; equals in ordinary value preserved");
   HttpRequest onlySecrets{.headers = {{"COOKIE", "__Host-SESSION=one; __Host-SESSION=two"},
                                      {"cookie", "SESSION=old"}}};
   stripAuthenticationHeaders(onlySecrets);
   require(onlySecrets.headers.empty(), "all-secret duplicate cookie headers erased");
   HttpRequest lookalikes{.headers = {{"cookie", "session=ordinary; __Host-SESSION-TAG=ordinary"}}};
   stripAuthenticationHeaders(lookalikes);
   require(lookalikes.headers[0].value == "session=ordinary; __Host-SESSION-TAG=ordinary",
           "ordinary cookie names are case-sensitive and not prefix-matched");
   auto cors = defaultPreflightHeaders();
   require(HttpHeader::get(cors, "Access-Control-Allow-Origin") == "*", "public preflight origin preserved");
   require(HttpHeader::get(cors, "Access-Control-Allow-Headers") == "*, Authorization", "explicit Authorization preflight");
   require(!HttpHeader::get(cors, "Access-Control-Allow-Credentials"), "no broad credentialed CORS grant");
   std::printf("%u production HttpServer header checks passed\n", checks);
}
