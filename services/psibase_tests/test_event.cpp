#include "event-service.hpp"

#include <psibase/DefaultTestChain.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/Transact.hpp>

#include <catch2/catch.hpp>

using namespace psibase;
using namespace std::literals::string_literals;

///////////////////////////////////

struct HistoryEvent
{
   std::string s;
   int         i;
};
PSIO_REFLECT(HistoryEvent, s, i);

struct Events
{
   std::vector<HistoryEvent> history;
};
PSIO_REFLECT(Events, history);

struct EventsData
{
   Events events;
};
PSIO_REFLECT(EventsData, events);

struct EventsRoot
{
   EventsData data;
};
PSIO_REFLECT(EventsRoot, data);

///////////////////////////////////

struct FooEventRecord
{
   std::string s;
   int         i;
};
PSIO_REFLECT(FooEventRecord, s, i);

struct FooEventRecordEdge
{
   FooEventRecord node;
   std::string    cursor;
};
PSIO_REFLECT(FooEventRecordEdge, node, cursor);

struct FooEventRecordConnection
{
   std::vector<FooEventRecordEdge> edges;
};
PSIO_REFLECT(FooEventRecordConnection, edges);

struct Foo2Events
{
   FooEventRecordConnection foo2Events;
};
PSIO_REFLECT(Foo2Events, foo2Events);

struct Foo2EventsRoot
{
   Foo2Events data;
};
PSIO_REFLECT(Foo2EventsRoot, data);

///////////////////////////////////

struct ExampleRecordQuery
{
   ExampleRecord r;
};
PSIO_REFLECT(ExampleRecordQuery, r);

struct ExampleRecordQueryEdge
{
   ExampleRecordQuery node;
   std::string        cursor;
};
PSIO_REFLECT(ExampleRecordQueryEdge, node, cursor);

struct ExampleRecordQueryConnection
{
   std::vector<ExampleRecordQueryEdge> edges;
};
PSIO_REFLECT(ExampleRecordQueryConnection, edges);

struct ExampleRecordData
{
   ExampleRecordQueryConnection exampleRecords;
};
PSIO_REFLECT(ExampleRecordData, exampleRecords);

struct ExampleRecordQueryRoot
{
   ExampleRecordData data;
};
PSIO_REFLECT(ExampleRecordQueryRoot, data);

///////////////////////////////////

auto query(DefaultTestChain& t, const std::string& query_str)
{
   std::string_view query_sv = query_str;
   auto             query    = GraphQLBody{query_sv};

   std::cout << "Querying: " << std::string(query_sv) << "\n";
   auto res = t.post(EventService::service, "/graphql", query);

   auto body = std::string(res.body.begin(), res.body.end());
   std::cout << "Response: " << body << "\n";

   return body;
}

template <typename QueryRoot>
auto gql(DefaultTestChain& t, const std::string& query_str)
{
   auto body = query(t, query_str);
   return psio::convert_from_json<QueryRoot>(body);
}

TEST_CASE("test events")
{
   DefaultTestChain t;
   auto             event_service =
       t.from(t.addService("event-service"_a, "event-service.wasm")).to<EventService>();
   REQUIRE(event_service.init().succeeded());

   auto evId = event_service.foo("antidisestablishmentarianism", 42).returnVal();

   {
      auto [s, i] = EventService().events().history().e(evId);
      CHECK(s == "antidisestablishmentarianism"s);
      CHECK(i == 42);
   }

   std::string query = "query { events { history(ids: [" + std::to_string(evId) + "]) { s i } } }";
   auto        response = gql<EventsRoot>(t, query);

   auto history = response.data.events.history;
   REQUIRE(history.size() == 1);

   {
      auto [s, i] = history.back();
      REQUIRE(i == 42);
      REQUIRE(s == "antidisestablishmentarianism");
   }
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

TEST_CASE("graphql")
{
   DefaultTestChain t;

   auto event_service =
       t.from(t.addService("event-service"_a, "event-service.wasm")).to<EventService>();
   REQUIRE(event_service.init().succeeded());

   auto query = [](std::string query_name, std::string params, std::string fields) {  //
      if (!params.empty())
         params = "(" + params + ")";
      return std::string{"query { " + query_name + params + " { edges { node { " + fields +
                         " } cursor } } }"};
   };

   auto foo_query = [&](std::string params) {  //
      return query("foo2Events", params, "s i");
   };

   auto example_query = [&](std::string params) {  //
      return query("exampleRecords", params, "r { count value message }");
   };

   REQUIRE(event_service.foo2("h", 1).succeeded());
   REQUIRE(event_service.foo2("e", 2).succeeded());
   REQUIRE(event_service.foo2("l", 3).succeeded());
   REQUIRE(event_service.foo2("l", 4).succeeded());
   REQUIRE(event_service.foo2("o", 5).succeeded());

   auto r     = gql<Foo2EventsRoot>(t, foo_query(""));
   auto edges = r.data.foo2Events.edges;
   REQUIRE(edges.size() == 5);
   auto c1 = edges[0].cursor;
   auto c2 = edges[1].cursor;
   auto c3 = edges[2].cursor;
   auto c4 = edges[3].cursor;
   auto c5 = edges[4].cursor;

   auto quote = [](std::string s) { return "\"" + s + "\""; };

   {
      auto response = gql<Foo2EventsRoot>(t, foo_query("first: 1"));
      auto events   = response.data.foo2Events.edges;
      CHECK(events.size() == 1);
      CHECK(events[0].node.s == "h");
   }

   {
      auto response = gql<Foo2EventsRoot>(t, foo_query("first: 1 after: " + quote(c1)));
      auto events   = response.data.foo2Events.edges;
      CHECK(events.size() == 1);
      CHECK(events[0].cursor == c2);
   }

   {
      auto response = gql<Foo2EventsRoot>(t, foo_query("last: 1"));
      auto events   = response.data.foo2Events.edges;
      CHECK(events.size() == 1);
      CHECK(events[0].node.s == "o");
   }

   {
      auto response = gql<Foo2EventsRoot>(t, foo_query("last: 2, before: " + quote(c4)));
      auto events   = response.data.foo2Events.edges;
      CHECK(events.size() == 2);
      CHECK(events[0].cursor == c2);
      CHECK(events[1].cursor == c3);
   }

   REQUIRE(event_service.emitExample(ExampleRecord{4, -4, "square root of 16"}).succeeded());

   {
      auto response = gql<ExampleRecordQueryRoot>(t, example_query(""));
      auto edges    = response.data.exampleRecords.edges;
      REQUIRE(edges.size() == 1);
      CHECK(edges[0].node.r == ExampleRecord{4, -4, "square root of 16"});
   }
}