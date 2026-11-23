// GraphQL as psibase services use it: a query root over table indexes
// (psibase::serveGraphQL, psibase::IndexView, the resolver of a TableIndex,
// psibase::WithBlockContext) on PSIO's engine (psio/graphql.hpp). The native
// build reads the rows from the key-value store of tables.cpp, the guest from
// a test chain.
#include <psibase/psibase.hpp>

#include <catch2/catch_all.hpp>
#ifdef COMPILING_WASM
#include <psibase/tester.hpp>
#endif

#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace graphql_test
{
   using psibase::AccountNumber;
   namespace gql = psio::graphql;

   struct Item
   {
      std::uint32_t              id = 0;
      AccountNumber              owner;
      std::string                note;
      std::uint64_t              big = 0;
      std::int64_t               neg = 0;
      psibase::TimePointSec      created;
      psibase::TimePointUSec     updated;
      psibase::Checksum256       hash{};
      std::vector<char>          data;
      std::optional<std::string> memo;
      std::string                label(std::string prefix) const { return prefix + note; }
      PSIO_REFLECT(Item,
                   id,
                   owner,
                   note,
                   big,
                   neg,
                   created,
                   updated,
                   hash,
                   data,
                   memo,
                   method(label, prefix))
   };
   using ByOwner   = psibase::CompositeKey<&Item::owner, &Item::id>;
   using ItemTable = psibase::Table<Item, &Item::id, ByOwner{}>;

   // What a query shows of an item
   struct Shown
   {
      std::uint32_t id = 0;
      std::string   text;
      PSIO_REFLECT(Shown, id, text)
   };
   struct Ev
   {
      std::uint32_t n = 0;
      std::string   what;
      PSIO_REFLECT(Ev, n, what)
   };

   const AccountNumber service{"gql-test"};

   // Where the rows are: the store of tables.cpp natively, the service
   // database of a test chain in the guest
   psibase::KvHandle database()
   {
#ifdef COMPILING_WASM
      static psibase::TestChain chain;
      static auto handle = psibase::kvOpen(psibase::DbId::service, {}, psibase::KvMode::readWrite);
      return handle;
#else
      return psibase::KvHandle{0};
#endif
   }

   ItemTable open()
   {
      return ItemTable{database(), psibase::tablePrefix(service, 7), psibase::KvMode::readWrite};
   }

   // Items 1..6; odd ids belong to alice, even ones to bob
   void fill()
   {
      auto table = open();
      for (std::uint32_t i = 1; i <= 6; ++i)
      {
         Item item;
         item.id      = i;
         item.owner   = AccountNumber{i % 2 ? "alice" : "bob"};
         item.note    = "n" + std::to_string(i);
         item.big     = i == 6 ? ~0ull : i;
         item.neg     = -static_cast<std::int64_t>(i);
         item.created = psibase::TimePointSec{psibase::Seconds{1700000000 + i}};
         item.updated = psibase::TimePointUSec{psibase::MicroSeconds{1700000000000000 + i * 250000}};
         item.hash[0] = i;
         item.data    = {'\x01', '\xff'};
         if (i % 3 == 0)
            item.memo = "m" + std::to_string(i);
         table.put(item);
      }
   }

   struct Query
   {
      AccountNumber service;
      std::uint32_t version = 3;

      std::optional<Item> item(std::uint32_t id) const { return open().get(id); }
      std::vector<Item>   some(std::vector<std::uint32_t> ids) const
      {
         std::vector<Item> result;
         for (auto id : ids)
            if (auto row = open().get(id))
               result.push_back(std::move(*row));
         return result;
      }
      // An index as it is: the resolver of TableIndex gives the field its arguments
      auto items() const { return open().getIndex<0>(); }
      // Part of an index: the keys are what follows the owner
      auto itemsOf(AccountNumber owner) const
      {
         return open().getIndex<1>().subindex<std::uint32_t>(owner);
      }
      // A composite key bounded by its first element
      auto byOwner(gql::key_range<AccountNumber> range, gql::page_args page) const
      {
         return gql::paginate(psibase::IndexView{open().getIndex<1>()}, range, page,
                              psibase::allRows);
      }
      // Rows shown as another record, two to a page
      auto shown(gql::page_args page) const
      {
         return gql::paginate(gql::transform(psibase::IndexView{open().getIndex<0>()},
                                             [](psio::shared_pssz<Item> row) {
                                                return Shown{row->id(), "item " + row.unpack().note};
                                             }),
                              page, 2);
      }
      // A page holds the rows that fit in a budget
      auto budget(gql::page_args page) const
      {
         return gql::paginate(
             psibase::IndexView{open().getIndex<0>()}, page,
             gql::page_budget{.max_bytes = budgetBytes, .max_page_size = psibase::allRows.max_page_size});
      }
      std::uint32_t budgetBytes = 0;

      psibase::ConsensusData                consensus() const { return psibase::BftConsensus{}; }
      std::optional<psibase::ConsensusData> nextConsensus() const { return std::nullopt; }
      psibase::SocketInfo socket(std::uint32_t kind) const
      {
         if (kind == 0)
            return psibase::LogSocketInfo{};
         return psibase::WebSocketInfo{
             .endpoint = psibase::SocketEndpoint{psibase::LocalEndpoint{"/tmp/sock"}},
             .tls      = kind == 2 ? std::optional{psibase::TLSInfo{}} : std::nullopt};
      }
      psibase::WithBlockContext<Ev> event() const
      {
         return {psibase::EventBlockInfo{9, std::nullopt}, Ev{4, "stored"}};
      }
      // A connection built by hand, as EventQuery builds it
      auto events(gql::page_args page) const -> gql::result<gql::connection<psibase::WithBlockContext<Ev>>>
      {
         if (page.first && page.last)
            return gql::fail("Arguments \"first\" and \"last\" cannot both be given.");
         gql::connection_builder<psibase::WithBlockContext<Ev>> out;
         for (std::uint64_t rowid = 1; rowid <= 2; ++rowid)
         {
            auto cursor = psio::to_key(rowid);
            out.add({psibase::EventBlockInfo{}, Ev{static_cast<std::uint32_t>(rowid), "e"}},
                    std::span<const char>{cursor.data(), cursor.size()});
         }
         return std::move(out).finish(false, true);
      }
      gql::result<std::uint32_t> checked(std::uint32_t x) const
      {
         if (x > 3)
            return gql::fail("x is too large");
         return x;
      }
   };
   PSIO_REFLECT(Query,
                attr(service, psio::graphql::hidden),
                version,
                attr(budgetBytes, psio::graphql::hidden),
                method(item, id),
                method(some, ids),
                method(items),
                method(itemsOf, owner),
                method(byOwner, range, page),
                method(shown, page),
                method(budget, page),
                method(consensus),
                method(nextConsensus),
                method(socket, kind),
                method(event),
                method(events, page),
                method(checked, x))

   // A root that is not called Query
   struct Root
   {
      std::uint32_t one = 1;
      PSIO_REFLECT(Root, one)
   };
   PSIO_TYPE_ATTRS(Root, psio::graphql::name_as{"Query"})

   using api = gql::schema<Query>;

   std::string run(std::string_view query, std::string_view variables = {}, std::uint32_t budget = 0)
   {
      fill();
      std::string  out;
      gql::request req;
      req.variables = variables;
      Query root{service};
      root.budgetBytes = budget;
      api::run(root, query, out, req);
      return out;
   }

   psibase::HttpRequest request(std::string method,
                                std::string target,
                                std::string contentType = "",
                                std::string body        = "")
   {
      psibase::HttpRequest result;
      result.host        = "gql-test.psibase.io";
      result.method      = std::move(method);
      result.target      = std::move(target);
      result.contentType = std::move(contentType);
      result.body.assign(body.begin(), body.end());
      return result;
   }
   std::string text(const std::optional<psibase::HttpReply>& reply)
   {
      REQUIRE(reply.has_value());
      return std::string(reply->body.begin(), reply->body.end());
   }

   constexpr std::string_view page = "edges { node { id } cursor } pageInfo { hasPreviousPage "
                                     "hasNextPage startCursor endCursor }";
}  // namespace graphql_test

using namespace graphql_test;

TEST_CASE("graphql: the schema of a query root", "[graphql]")
{
   CHECK(api::sdl() == R"(type Query {
  version: Int!
  item(id: Int!): Item
  some(ids: [Int!]!): [Item!]!
  items(gt: Int, ge: Int, lt: Int, le: Int, first: Int, last: Int, before: String, after: String): ItemConnection
  itemsOf(owner: AccountNumber!, gt: Int, ge: Int, lt: Int, le: Int, first: Int, last: Int, before: String, after: String): ItemConnection
  byOwner(gt: AccountNumber, ge: AccountNumber, lt: AccountNumber, le: AccountNumber, first: Int, last: Int, before: String, after: String): ItemConnection
  shown(first: Int, last: Int, before: String, after: String): ShownConnection
  budget(first: Int, last: Int, before: String, after: String): ItemConnection
  consensus: ConsensusData!
  nextConsensus: ConsensusData
  socket(kind: Int!): SocketInfo!
  event: EvWithBlockContext!
  events(first: Int, last: Int, before: String, after: String): EvConnection
  checked(x: Int!): Int
}

type Item {
  id: Int!
  owner: AccountNumber!
  note: String!
  big: UInt64!
  neg: Int64!
  created: DateTimeSeconds!
  updated: DateTimeMicroseconds!
  hash: Bytes!
  data: Bytes!
  memo: String
  label(prefix: String!): String!
}

type ItemConnection {
  edges: [ItemEdge!]!
  pageInfo: PageInfo!
}

scalar AccountNumber

type ShownConnection {
  edges: [ShownEdge!]!
  pageInfo: PageInfo!
}

union ConsensusData = CftConsensus | BftConsensus

union SocketInfo = ProducerMulticastSocketInfo | LogSocketInfo | HttpSocketInfo | HttpClientSocketInfo | WebSocketInfo | P2PSocketInfo

type EvWithBlockContext {
  block: EventBlockInfo!
  n: Int!
  what: String!
}

type EvConnection {
  edges: [EvEdge!]!
  pageInfo: PageInfo!
}

scalar UInt64

scalar Int64

scalar DateTimeSeconds

scalar DateTimeMicroseconds

scalar Bytes

type ItemEdge {
  node: Item!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

type ShownEdge {
  node: Shown!
  cursor: String!
}

type CftConsensus {
  producers: [Producer!]!
}

type BftConsensus {
  producers: [Producer!]!
}

type ProducerMulticastSocketInfo {
  _: Boolean
}

type LogSocketInfo {
  _: Boolean
}

type HttpSocketInfo {
  endpoint: SocketEndpoint
  tls: TLSInfo
}

type HttpClientSocketInfo {
  endpoint: SocketEndpoint
  tls: TLSInfo
}

type WebSocketInfo {
  endpoint: SocketEndpoint
  tls: TLSInfo
}

type P2PSocketInfo {
  endpoint: SocketEndpoint
  tls: TLSInfo
}

type EventBlockInfo {
  blockNum: Int
  blockTime: DateTimeMicroseconds
}

type EvEdge {
  node: EvWithBlockContext!
  cursor: String!
}

type Shown {
  id: Int!
  text: String!
}

type Producer {
  name: AccountNumber!
  auth: Claim!
}

scalar SocketEndpoint

type TLSInfo {
  _: Boolean
}

type Claim {
  service: AccountNumber!
  rawData: Bytes!
}
)");
   CHECK(gql::schema<Root>::sdl() == "type Query {\n  one: Int!\n}\n");
}

TEST_CASE("graphql: fields, methods and their results", "[graphql]")
{
   CHECK(run("{ version }") == R"({"data":{"version":3}})");
   CHECK(run(R"({ item(id: 6) { id owner note big neg created updated hash data memo label(prefix: ">") } })") ==
         R"({"data":{"item":{"id":6,"owner":"bob","note":"n6","big":"18446744073709551615","neg":-6,"created":"2023-11-14T22:13:26Z","updated":"2023-11-14T22:13:21.500000Z","hash":"0600000000000000000000000000000000000000000000000000000000000000","data":"01FF","memo":"m6","label":">n6"}}})");
   CHECK(run("{ a: item(id: 1) { big memo } missing: item(id: 77) { id } }") ==
         R"({"data":{"a":{"big":1,"memo":null},"missing":null}})");
   CHECK(run("{ some(ids: [2, 9, 3]) { id owner } }") ==
         R"({"data":{"some":[{"id":2,"owner":"bob"},{"id":3,"owner":"alice"}]}})");
   // A union, an absent one, and the alternatives without members
   CHECK(run("{ consensus { __typename ... on BftConsensus { producers { name } } } nextConsensus "
             "{ __typename } }") ==
         R"({"data":{"consensus":{"__typename":"BftConsensus","producers":[]},"nextConsensus":null}})");
   CHECK(run("{ socket(kind: 0) { __typename ... on LogSocketInfo { _ } ... on WebSocketInfo { tls { _ } } } }") ==
         R"({"data":{"socket":{"__typename":"LogSocketInfo","_":true}}})");
   // SocketEndpoint has a text form: a scalar
   CHECK(run("{ socket(kind: 2) { ... on WebSocketInfo { endpoint tls { _ } } } }") ==
         R"({"data":{"socket":{"endpoint":"/tmp/sock","tls":{"_":true}}}})");
   CHECK(run("{ socket(kind: 1) { ... on WebSocketInfo { tls { __typename } } } }") ==
         R"({"data":{"socket":{"tls":null}}})");
   // The event's members are beside its block
   CHECK(run("{ event { block { blockNum blockTime } n what } }") ==
         R"({"data":{"event":{"block":{"blockNum":9,"blockTime":null},"n":4,"what":"stored"}}})");
}

TEST_CASE("graphql: pages of a table index", "[graphql]")
{
   const std::string p{page};
   // No `first`: every row. A cursor is the upper-case hex of the key.
   CHECK(run("{ items { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":1},"cursor":"00000001"},{"node":{"id":2},"cursor":"00000002"},{"node":{"id":3},"cursor":"00000003"},{"node":{"id":4},"cursor":"00000004"},{"node":{"id":5},"cursor":"00000005"},{"node":{"id":6},"cursor":"00000006"}],"pageInfo":{"hasPreviousPage":false,"hasNextPage":false,"startCursor":"00000001","endCursor":"00000006"}}}})");
   CHECK(run("{ items(first: 2) { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":1},"cursor":"00000001"},{"node":{"id":2},"cursor":"00000002"}],"pageInfo":{"hasPreviousPage":false,"hasNextPage":true,"startCursor":"00000001","endCursor":"00000002"}}}})");
   CHECK(run("{ items(first: 2, after: \"00000002\") { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":3},"cursor":"00000003"},{"node":{"id":4},"cursor":"00000004"}],"pageInfo":{"hasPreviousPage":true,"hasNextPage":true,"startCursor":"00000003","endCursor":"00000004"}}}})");
   CHECK(run("{ items(last: 2, before: \"00000005\") { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":3},"cursor":"00000003"},{"node":{"id":4},"cursor":"00000004"}],"pageInfo":{"hasPreviousPage":true,"hasNextPage":true,"startCursor":"00000003","endCursor":"00000004"}}}})");
   CHECK(run("{ items(ge: 2, lt: 5) { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":2},"cursor":"00000002"},{"node":{"id":3},"cursor":"00000003"},{"node":{"id":4},"cursor":"00000004"}],"pageInfo":{"hasPreviousPage":false,"hasNextPage":false,"startCursor":"00000002","endCursor":"00000004"}}}})");
   CHECK(run("{ items(gt: 2, le: 5, first: 1) { " + p + " } }") == R"({"data":{"items":{"edges":[{"node":{"id":3},"cursor":"00000003"}],"pageInfo":{"hasPreviousPage":false,"hasNextPage":true,"startCursor":"00000003","endCursor":"00000003"}}}})");
   // An empty page has no cursors
   CHECK(run("{ items(gt: 6) { " + p + " } }") == R"({"data":{"items":{"edges":[],"pageInfo":{"hasPreviousPage":false,"hasNextPage":false,"startCursor":null,"endCursor":null}}}})");
   // Errors of the page arguments
   CHECK(run("{ items(first: 1, last: 1) { edges { cursor } } version }") == R"({"data":{"items":null,"version":3},"errors":[{"message":"Arguments \"first\" and \"last\" cannot both be given.","locations":[{"line":1,"column":3}],"path":["items"]}]})");
   CHECK(run("{ items(after: \"zz\") { edges { cursor } } }") == R"({"data":{"items":null},"errors":[{"message":"Argument \"after\" is not a cursor.","locations":[{"line":1,"column":3}],"path":["items"]}]})");
   CHECK(run("{ items(first: -1) { edges { cursor } } }") == R"({"data":{"items":null},"errors":[{"message":"Arguments \"first\" and \"last\" must not be negative.","locations":[{"line":1,"column":3}],"path":["items"]}]})");
   // Part of an index
   CHECK(run("{ itemsOf(owner: \"bob\", ge: 3) { " + p + " } }") == R"({"data":{"itemsOf":{"edges":[{"node":{"id":4},"cursor":"00000004"},{"node":{"id":6},"cursor":"00000006"}],"pageInfo":{"hasPreviousPage":false,"hasNextPage":false,"startCursor":"00000004","endCursor":"00000006"}}}})");
   CHECK(run("{ itemsOf(owner: \"carol\") { " + p + " } }") == R"({"data":{"itemsOf":{"edges":[],"pageInfo":{"hasPreviousPage":false,"hasNextPage":false,"startCursor":null,"endCursor":null}}}})");
   // A bound that is the first element of the key: `gt` skips, and `le`
   // includes, every row that starts with it
   CHECK(run("{ byOwner(gt: \"alice\") { edges { node { id owner } } } }") == R"({"data":{"byOwner":{"edges":[{"node":{"id":2,"owner":"bob"}},{"node":{"id":4,"owner":"bob"}},{"node":{"id":6,"owner":"bob"}}]}}})");
   CHECK(run("{ byOwner(le: \"alice\", last: 1) { edges { node { id owner } cursor } } }") == R"({"data":{"byOwner":{"edges":[{"node":{"id":5,"owner":"alice"},"cursor":"04DFAE831B2AB80000000005"}]}}})");
   // Transformed rows, with a page size limit of 2
   CHECK(run("{ shown { edges { node { id text } } pageInfo { hasNextPage endCursor } } }") == R"({"data":{"shown":{"edges":[{"node":{"id":1,"text":"item n1"}},{"node":{"id":2,"text":"item n2"}}],"pageInfo":{"hasNextPage":true,"endCursor":"00000002"}}}})");
   CHECK(run("{ shown(first: 5, after: \"00000004\") { edges { node { id text } } pageInfo { hasNextPage } } }") == R"({"data":{"shown":{"edges":[{"node":{"id":5,"text":"item n5"}},{"node":{"id":6,"text":"item n6"}}],"pageInfo":{"hasNextPage":false}}}})");
   // A byte budget: at least one row, then as many as fit
   CHECK(run("{ budget { edges { node { id } } pageInfo { hasNextPage } } }", {}, 1) == R"({"data":{"budget":{"edges":[{"node":{"id":1}}],"pageInfo":{"hasNextPage":true}}}})");
   CHECK(run("{ budget { edges { node { id } } pageInfo { hasNextPage } } }", {}, 100000) == R"({"data":{"budget":{"edges":[{"node":{"id":1}},{"node":{"id":2}},{"node":{"id":3}},{"node":{"id":4}},{"node":{"id":5}},{"node":{"id":6}}],"pageInfo":{"hasNextPage":false}}}})");
   // A connection built by hand
   CHECK(run("{ events { edges { node { block { blockNum } n what } cursor } pageInfo { hasNextPage "
             "startCursor endCursor } } }") == R"({"data":{"events":{"edges":[{"node":{"block":{"blockNum":null},"n":1,"what":"e"},"cursor":"0000000000000001"},{"node":{"block":{"blockNum":null},"n":2,"what":"e"},"cursor":"0000000000000002"}],"pageInfo":{"hasNextPage":true,"startCursor":"0000000000000001","endCursor":"0000000000000002"}}}})");
   CHECK(run("{ events(first: 1, last: 1) { edges { cursor } } }") == R"({"data":{"events":null},"errors":[{"message":"Arguments \"first\" and \"last\" cannot both be given.","locations":[{"line":1,"column":3}],"path":["events"]}]})");
}

TEST_CASE("graphql: errors and variables", "[graphql]")
{
   // A resolver's error is a field error: no exception is involved
   CHECK(run("{ ok: checked(x: 1) bad: checked(x: 9) version }") == R"({"data":{"ok":1,"bad":null,"version":3},"errors":[{"message":"x is too large","locations":[{"line":1,"column":21}],"path":["bad"]}]})");
   CHECK(run("{ nosuch }") == R"({"errors":[{"message":"Cannot query field \"nosuch\" on type \"Query\".","locations":[{"line":1,"column":3}]}]})");
   CHECK(run("{ service }") == R"({"errors":[{"message":"Cannot query field \"service\" on type \"Query\".","locations":[{"line":1,"column":3}]}]})");
   CHECK(run("{ version ") == R"({"errors":[{"message":"Syntax Error: Expected Name, found <EOF>.","locations":[{"line":1,"column":11}]}]})");
   CHECK(run("{ item(id: \"x\") { id } }") == R"({"errors":[{"message":"Expected value of type \"Int\", found \"x\".","locations":[{"line":1,"column":12}]}]})");
   CHECK(run("query Q($id: Int!, $owner: AccountNumber!) { item(id: $id) { ...F } itemsOf(owner: "
             "$owner, first: 1) { edges { node { ...F } } } } fragment F on Item { id owner }",
             R"({"id":4,"owner":"alice"})") == R"({"data":{"item":{"id":4,"owner":"bob"},"itemsOf":{"edges":[{"node":{"id":1,"owner":"alice"}}]}}})");
   CHECK(run("query Q($id: Int!) { item(id: $id) { id } }") == R"({"errors":[{"message":"Variable \"$id\" of required type \"Int!\" was not provided.","locations":[{"line":1,"column":9}]}]})");
}

TEST_CASE("graphql: serveGraphQL", "[graphql]")
{
   fill();
   Query root{service};
   CHECK(!psibase::serveGraphQL(request("GET", "/other"), root));
   auto schema = psibase::serveGraphQL(request("GET", "/graphql"), root);
   CHECK(text(schema) == api::sdl());
   CHECK(schema->contentType == "text/plain");
   auto reply = psibase::serveGraphQL(request("GET", "/graphql?query={version}"), root);
   CHECK(text(reply) == R"({"data":{"version":3}})");
   CHECK(reply->contentType == "application/json");
   CHECK(text(psibase::serveGraphQL(
             request("POST", "/graphql", "application/graphql", "{ item(id: 2) { note } }"), root)) ==
         R"({"data":{"item":{"note":"n2"}}})");
   CHECK(text(psibase::serveGraphQL(
             request("POST", "/graphql", "application/json", R"({"query":"{ version }"})"), root)) ==
         R"({"data":{"version":3}})");
   CHECK(text(psibase::serveGraphQL(
             request("POST", "/graphql", "application/json",
                     R"({"query":"query A { version } query B($id: Int!) { item(id: $id) { owner } }",)"
                     R"("variables":{"id":5},"operationName":"B"})"),
             root)) == R"({"data":{"item":{"owner":"alice"}}})");
   CHECK(text(psibase::serveGraphQL(request("POST", "/graphql", "application/json",
                                            R"({"query":"{ version }","variables":null})"),
                                    root)) == R"({"data":{"version":3}})");
   CHECK(!psibase::serveGraphQL(request("POST", "/graphql", "text/plain", "{ version }"), root));
}
