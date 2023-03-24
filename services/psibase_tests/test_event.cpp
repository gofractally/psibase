#include "event-service.hpp"

#include <psibase/DefaultTestChain.hpp>
#include <psibase/serveGraphQL.hpp>

#include <catch2/catch.hpp>

using namespace psibase;
using namespace std::literals::string_literals;

struct Query
{
   auto events() const { return EventQuery<EventService::Events>{EventService::service}; }
};
PSIO_REFLECT(Query, method(events))

TEST_CASE("test events")
{
   DefaultTestChain t;
   auto             test_service = t.addService("event-service"_a, "event-service.wasm");

   auto evId = t.from("event-service"_a)
                   .to<EventService>()
                   .foo("antidisestablishmentarianism", 42)
                   .returnVal();
   auto [s, i] = EventService().events().history().e(evId);
   CHECK(s == "antidisestablishmentarianism"s);
   CHECK(i == 42);

   std::string query = "query { events { history(ids: [" + std::to_string(evId) + "]) { s i } } }";

   HttpRequest request  = {.host        = "event-service.psibase.127.0.0.1.sslip.io",
                           .rootHost    = "psibase.127.0.0.1.sslip.io",
                           .method      = "POST",
                           .target      = "/graphql",
                           .contentType = "application/graphql",
                           .body        = std::vector(query.begin(), query.end())};
   auto        response = serveGraphQL(request, Query());
   REQUIRE(!!response);
   auto response_body = std::string_view(response->body.data(), response->body.size());
   CHECK(response_body ==
         R"""({"data": {"events":{"history":[{"s":"antidisestablishmentarianism","i":42}]}}})""");
}
