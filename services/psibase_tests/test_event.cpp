#include "event-service.hpp"

#include <psibase/DefaultTestChain.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/Transact.hpp>

#include <catch2/catch.hpp>

using namespace psibase;
using namespace std::literals::string_literals;

struct Query
{
   auto events() const { return LegacyEventQuery<EventService::Events>{EventService::service}; }
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

TEST_CASE("test merkle events")
{
   DefaultTestChain t;
   t.addService("event-service"_a, "event-service.wasm");
   auto event_service = t.from("event-service"_a).to<EventService>();
   t.setAutoBlockStart(false);
   t.startBlock();
   {
      auto id   = event_service.emitMerkle("a").returnVal();
      auto data = getSequentialRaw(DbId::merkleEvent, id);
      REQUIRE(!!data);
      Merkle merkle;
      merkle.push(EventInfo{id, *data});
      auto expected_root = merkle.root();
      t.startBlock();
      auto actual_root = SystemService::getStatus().head->header.eventMerkleRoot;
      CHECK(expected_root == actual_root);
   }
   {
      auto id1   = event_service.emitMerkle("a").returnVal();
      auto id2   = event_service.emitMerkle("b").returnVal();
      auto data1 = getSequentialRaw(DbId::merkleEvent, id1);
      auto data2 = getSequentialRaw(DbId::merkleEvent, id2);
      REQUIRE(!!data1);
      REQUIRE(!!data2);
      Merkle merkle;
      merkle.push(EventInfo{id1, *data1});
      merkle.push(EventInfo{id2, *data2});
      auto expected_root = merkle.root();
      t.startBlock();
      auto actual_root = SystemService::getStatus().head->header.eventMerkleRoot;
      CHECK(expected_root == actual_root);
   }
}

TEST_CASE("test event in failed transaction")
{
   DefaultTestChain t;

   auto event_service =
       t.from(t.addService("event-service"_a, "event-service.wasm")).to<EventService>();

   auto id1 = event_service.foo("a", 1).returnVal();
   auto id2 = event_service.foo("b", 2).returnVal();
   CHECK(event_service.emitFail("c", 3).failed("die"));
   auto id3 = event_service.foo("d", 4).returnVal();
   CHECK(id2 - id1 == id3 - id2);
}
