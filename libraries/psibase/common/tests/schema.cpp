// The service schema over the PSIO Schema IR
// (doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md section 2):
// the record, its two encodings, schema-driven packing and printing of
// action arguments (the Action handler included) and schema comparison.
// Runs natively and in a WASM guest.
#include <catch2/catch_all.hpp>

#include <psibase/Service.hpp>
#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/schema.hpp>

#include <psio/to_hex.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <tuple>
#include <vector>

using namespace psibase;
namespace ir = psio::pssz_ir;
namespace st = psio::schema_types;

namespace schema_test
{
   struct Row
   {
      AccountNumber owner;
      std::uint64_t n = 0;
   };
   PSIO_REFLECT(Row, owner, n)
   using RowTable = Table<Row, &Row::owner>;
   PSIO_REFLECT_TYPENAME(RowTable)
   using ByN        = CompositeKey<&Row::n, &Row::owner>;
   using TwoKeyTable = Table<Row, &Row::owner, ByN{}>;
   PSIO_REFLECT_TYPENAME(TwoKeyTable)

   // The service of the example in section 2 of
   // doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md
   struct Svc
   {
      static constexpr auto service = AccountNumber{"svc"};
      using Tables                  = ServiceTables<RowTable>;

      void               credit(AccountNumber to, std::uint64_t amount, std::optional<std::string> memo) {}
      std::optional<Row> getRow(AccountNumber) { return {}; }
      void               init() {}
   };
   PSIO_REFLECT(Svc, method(credit, to, amount, memo), method(getRow), method(init))
   PSIBASE_REFLECT_TABLES(Svc, Svc::Tables)

   // A service that takes an action and a service method as arguments
   struct Caller
   {
      static constexpr auto service = AccountNumber{"caller"};
      void                  run(Action action, std::uint32_t delay) {}
      void                  watch(ServiceMethod target) {}
   };
   PSIO_REFLECT(Caller, method(run, action, delay), method(watch, target))

   // Revisions of a row
   struct Note
   {
      AccountNumber owner;
      std::string   text;
   };
   PSIO_REFLECT(Note, owner, text)
   struct NoteAppended
   {
      AccountNumber                owner;
      std::string                  text;
      std::optional<std::uint32_t> stars;
   };
   PSIO_REFLECT(NoteAppended, owner, text, stars)
   struct NoteChanged
   {
      AccountNumber              owner;
      std::vector<std::uint32_t> text;
   };
   PSIO_REFLECT(NoteChanged, owner, text)
   struct NoteRenamed
   {
      AccountNumber owner;
      std::string   body;
   };
   PSIO_REFLECT(NoteRenamed, owner, body)
   // A row whose members are all fixed-size
   struct RowAppended
   {
      AccountNumber                owner;
      std::uint64_t                n = 0;
      std::optional<std::uint32_t> stars;
   };
   PSIO_REFLECT(RowAppended, owner, n, stars)
   struct RowAppendedText
   {
      AccountNumber              owner;
      std::uint64_t              n = 0;
      std::optional<std::string> note;
   };
   PSIO_REFLECT(RowAppendedText, owner, n, note)

   struct WithTwoKeys
   {
      static constexpr auto service = AccountNumber{"twokeys"};
      using Tables                  = ServiceTables<TwoKeyTable>;
   };
   PSIO_REFLECT(WithTwoKeys)
   PSIBASE_REFLECT_TABLES(WithTwoKeys, WithTwoKeys::Tables)

   const std::string_view svcJson =
       R"({"service":"svc","types":{"package":{"name":"","version":"","attributes":[]},"interfaces":[],"worlds":[],"uses":[],"types":[)"
       R"({"name":"@0","type":{"value":{"Object":{"members":[)"
       R"({"name":"to","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]},)"
       R"({"name":"amount","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]},)"
       R"({"name":"memo","type":{"value":{"Type":{"type":"@3"}}},"attributes":[]}],)"
       R"("attributes":[{"name":"tuple","value":"named"}]}}},"attributes":[]},)"
       R"({"name":"AccountNumber","type":{"value":{"Custom":{"type":{"value":{"Object":{"members":[)"
       R"({"name":"value","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]}],)"
       R"("attributes":[{"name":"definitionWillNotChange","value":""}]}}},"id":"AccountNumber"}}},"attributes":[]},)"
       R"({"name":"@2","type":{"value":{"Int":{"bits":64,"isSigned":false}}},"attributes":[]},)"
       R"({"name":"@3","type":{"value":{"Option":{"type":{"value":{"Type":{"type":"@4"}}}}}},"attributes":[]},)"
       R"({"name":"@4","type":{"value":{"Custom":{"type":{"value":{"List":{"type":{"value":{"Type":{"type":"@5"}}}}}},"id":"string"}}},"attributes":[]},)"
       R"({"name":"@5","type":{"value":{"Int":{"bits":8,"isSigned":false}}},"attributes":[]},)"
       R"({"name":"@6","type":{"value":{"Object":{"members":[)"
       R"({"name":"0","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]}],)"
       R"("attributes":[{"name":"tuple","value":"positional"}]}}},"attributes":[]},)"
       R"({"name":"@7","type":{"value":{"Option":{"type":{"value":{"Type":{"type":"Row"}}}}}},"attributes":[]},)"
       R"({"name":"Row","type":{"value":{"Object":{"members":[)"
       R"({"name":"owner","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]},)"
       R"({"name":"n","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]}],"attributes":[]}}},"attributes":[]},)"
       R"({"name":"@9","type":{"value":{"Object":{"members":[],"attributes":[{"name":"tuple","value":"named"}]}}},"attributes":[]}],)"
       R"("ir_version":1},)"
       R"("actions":{)"
       R"("credit":{"params":{"value":{"Type":{"type":"@0"}}},"result":null},)"
       R"("getRow":{"params":{"value":{"Type":{"type":"@6"}}},"result":{"value":{"Type":{"type":"@7"}}}},)"
       R"("init":{"params":{"value":{"Type":{"type":"@9"}}},"result":null}},)"
       R"("history":{},"merkle":{},)"
       R"("database":{"service":[{"name":"RowTable","table":0,"type":{"value":{"Type":{"type":"Row"}}},)"
       R"("indexes":[[{"path":[0],"transform":null,"type":null}]]}]}})";

   std::span<const char> chars(std::string_view text)
   {
      return {text.data(), text.size()};
   }

   const st::Object& object(const st::Schema& schema, const st::AnyType& type)
   {
      const auto* resolved = type.resolve(schema);
      REQUIRE(resolved);
      const auto* result = std::get_if<st::Object>(&resolved->value);
      REQUIRE(result);
      return *result;
   }
}  // namespace schema_test

using namespace schema_test;

// Declaring the schema identity of Action / ServiceMethod changes no byte.
TEST_CASE("schema: Action and ServiceMethod are custom types with the bytes of their record",
          "[schema]")
{
   Action act{AccountNumber{1}, AccountNumber{2}, MethodNumber{3}, {'\x01', '\x02', '\x03'}};
   CHECK(psio::to_hex(psio::to_pssz(act)) ==
         "1C000000010000000000000002000000000000000300000000000000"
         "1C000000010203");
   CHECK(psio::to_pssz(act) == psio::to_pssz(std::tuple{act.sender, act.service, act.method,
                                                        act.rawData}));
   ServiceMethod method{AccountNumber{2}, MethodNumber{3}};
   CHECK(psio::to_pssz(method) == psio::to_pssz(std::tuple{method.service, method.method}));

   static_assert(psio::schema_custom_id<Action>() == "Action");
   static_assert(psio::schema_custom_id<ServiceMethod>() == "ServiceMethod");
   auto        schema = ServiceSchema::make<Caller>();
   const auto* action = schema.types.get("Action");
   REQUIRE(action);
   const auto* custom = std::get_if<st::Custom>(&action->value);
   REQUIRE(custom);
   CHECK(custom->id == "Action");
   CHECK(std::holds_alternative<st::Object>(custom->type->value));
   const auto* method_ = schema.types.get("ServiceMethod");
   REQUIRE(method_);
   REQUIRE(std::holds_alternative<st::Custom>(method_->value));
   CHECK(std::get<st::Custom>(method_->value).id == "ServiceMethod");
}

TEST_CASE("schema: the I-JSON of a service schema", "[schema]")
{
   std::vector<ServiceSchema::Collision> collisions;
   const auto                            schema = ServiceSchema::make<Svc>(Svc::service, &collisions);
   CHECK(collisions.empty());
   schema.checkValid();
   CHECK(psio::to_ijson(schema) == svcJson);

   // members, argument list forms, index paths
   CHECK(object(schema.types, *schema.actions.at("credit").params).attributes ==
         std::vector<st::Attribute>{{"tuple", "named"}});
   CHECK(object(schema.types, *schema.actions.at("getRow").params).attributes ==
         std::vector<st::Attribute>{{"tuple", "positional"}});
   CHECK(object(schema.types, *schema.actions.at("getRow").params).members.at(0).name == "0");
   CHECK(object(schema.types, *schema.actions.at("init").params).members.empty());
   CHECK(!schema.actions.at("credit").result);
   CHECK(schema.actions.at("getRow").result);
   REQUIRE(schema.database);
   const auto& table = schema.database->at("service").at(0);
   CHECK(table.name == std::optional<std::string>{"RowTable"});
   CHECK(table.table == 0);
   REQUIRE(table.indexes.size() == 1);
   REQUIRE(table.indexes[0].size() == 1);
   CHECK(table.indexes[0][0].path == std::vector<std::uint32_t>{0});
   CHECK(!table.indexes[0][0].transform);
   CHECK(!table.indexes[0][0].type);

   // lookup by method number
   REQUIRE(schema.findAction(MethodNumber{"credit"}));
   CHECK(schema.findAction(MethodNumber{"credit"})->first == "credit");
   CHECK(!schema.findAction(MethodNumber{"missing"}));

   // a composite secondary key
   const auto  two     = ServiceSchema::make<WithTwoKeys>();
   const auto& indexes = two.database->at("service").at(0).indexes;
   REQUIRE(indexes.size() == 2);
   REQUIRE(indexes[1].size() == 2);
   CHECK(indexes[1][0].path == std::vector<std::uint32_t>{1});
   CHECK(indexes[1][1].path == std::vector<std::uint32_t>{0});
   two.checkValid();
   const char* msg = nullptr;
   CHECK(getFieldType(two.types, two.database->at("service").at(0).type, indexes[1][0].path, msg));
   const std::uint32_t outOfRange[] = {7};
   CHECK(!getFieldType(two.types, two.database->at("service").at(0).type, outOfRange, msg));
}

TEST_CASE("schema: I-JSON to record to PSSZ and back", "[schema]")
{
   const auto schema = ServiceSchema::make<Svc>();
   const auto bytes  = psio::to_pssz(schema);
   CHECK(psio::validate_pssz<ServiceSchema>(bytes).ok());

   ServiceSchema fromText;
   REQUIRE(psio::decode_json_checked(psio::ijson{}, chars(svcJson), fromText).ok());
   fromText.checkValid();
   CHECK(psio::to_pssz(fromText) == bytes);
   CHECK(psio::to_ijson(fromText) == svcJson);

   auto fromBytes = psio::from_pssz<ServiceSchema>(bytes);
   CHECK(psio::to_ijson(fromBytes) == svcJson);

   // a key that is not UTF-8 is refused
   {
      auto spoiled = bytes;
      auto pos     = std::string_view{spoiled.data(), spoiled.size()}.find("credit");
      REQUIRE(pos != std::string_view::npos);
      spoiled[pos] = '\xff';
      CHECK(!psio::validate_pssz<ServiceSchema>(spoiled).ok());
   }
}

TEST_CASE("schema: action arguments are packed from JSON by the schema", "[schema]")
{
   const auto  schema   = ServiceSchema::make<Svc>();
   const auto  handlers = psibase_types();
   const auto& credit   = *schema.actions.at("credit").params;
   auto        pack     = [&](const st::AnyType& type, std::string_view text)
   {
      std::vector<char> out;
      auto status = ir::json_to_pssz(schema.types, type, psio::ijson{}, chars(text), out, nullptr,
                                     psio::json_parser::automatic, &handlers);
      INFO(std::string(status.ok() ? std::string_view{} : status.error().what));
      CHECK(status.ok());
      return out;
   };
   const auto expected = psio::method_args_to_pssz<Svc, 0>(
       AccountNumber{"bob"}, std::uint64_t{5}, std::optional<std::string>{"rent"});
   CHECK(pack(credit, R"({"to":"bob","amount":5,"memo":"rent"})") == expected);
   CHECK(pack(credit, R"({"memo":"rent","amount":5,"to":"bob"})") == expected);
   CHECK(pack(credit, R"(["bob",5,"rent"])") == expected);
   // a missing optional argument
   const auto noMemo = psio::method_args_to_pssz<Svc, 0>(AccountNumber{"bob"}, std::uint64_t{5},
                                                         std::optional<std::string>{});
   CHECK(pack(credit, R"({"to":"bob","amount":5})") == noMemo);
   CHECK(pack(credit, R"(["bob",5,null])") == noMemo);
   // positional only
   CHECK(pack(*schema.actions.at("getRow").params, R"(["alice"])") ==
         psio::method_args_to_pssz<Svc, 1>(AccountNumber{"alice"}));
   // no arguments
   CHECK(pack(*schema.actions.at("init").params, "{}") == psio::method_args_to_pssz<Svc, 2>());
   // (the empty argument list is one byte)
   CHECK(psio::to_hex(pack(*schema.actions.at("init").params, "{}")) == "00");
   CHECK(pack(*schema.actions.at("init").params, "[]") == psio::method_args_to_pssz<Svc, 2>());

   // a missing required argument, and an object for a positional list
   std::vector<char> out;
   CHECK(!ir::json_to_pssz(schema.types, credit, psio::ijson{}, chars(R"({"to":"bob"})"), out,
                           nullptr, psio::json_parser::automatic, &handlers)
              .ok());
   CHECK(!ir::json_to_pssz(schema.types, *schema.actions.at("getRow").params, psio::ijson{},
                           chars(R"({"0":"alice"})"), out, nullptr, psio::json_parser::automatic,
                           &handlers)
              .ok());

   // and printed
   std::string text;
   REQUIRE(ir::pssz_to_json(schema.types, credit, psio::ijson{}, std::span<const char>{expected},
                            text, nullptr, &handlers)
               .ok());
   CHECK(text == R"({"to":"bob","amount":5,"memo":"rent"})");
   text.clear();
   const auto rowBytes = psio::method_args_to_pssz<Svc, 1>(AccountNumber{"alice"});
   REQUIRE(ir::pssz_to_json(schema.types, *schema.actions.at("getRow").params, psio::ijson{},
                            std::span<const char>{rowBytes}, text, nullptr, &handlers)
               .ok());
   CHECK(text == R"(["alice"])");
}

TEST_CASE("schema: a nested Action is an object with its arguments decoded", "[schema]")
{
   const auto  svc    = ServiceSchema::make<Svc>();
   const auto  caller = ServiceSchema::make<Caller>();
   GetSchemaFn schemas = [&](AccountNumber service) -> const ServiceSchema*
   {
      if (service == Svc::service)
         return &svc;
      if (service == Caller::service)
         return &caller;
      return nullptr;
   };
   std::vector<std::pair<AccountNumber, AccountNumber>> seen;
   const auto handlers = action_types(
       schemas, [&](AccountNumber sender, AccountNumber service) { seen.push_back({sender, service}); });

   Action inner{AccountNumber{"alice"}, Svc::service, MethodNumber{"credit"},
                psio::method_args_to_pssz<Svc, 0>(AccountNumber{"bob"}, std::uint64_t{5},
                                                  std::optional<std::string>{})};
   const auto  bytes = psio::method_args_to_pssz<Caller, 0>(inner, std::uint32_t{7});
   const auto& run   = *caller.actions.at("run").params;

   std::string text;
   auto        status = ir::pssz_to_json(caller.types, run, psio::ijson{},
                                         std::span<const char>{bytes}, text, nullptr, &handlers);
   INFO(std::string(status.ok() ? std::string_view{} : status.error().what));
   REQUIRE(status.ok());
   const std::string expected =
       R"({"action":{"sender":"alice","service":"svc","method":"credit",)"
       R"("data":{"to":"bob","amount":5,"memo":null}},"delay":7})";
   CHECK(text == expected);

   std::vector<char> back;
   status = ir::json_to_pssz(caller.types, run, psio::ijson{}, chars(expected), back, nullptr,
                             psio::json_parser::automatic, &handlers);
   INFO(std::string(status.ok() ? std::string_view{} : status.error().what));
   REQUIRE(status.ok());
   CHECK(back == bytes);
   CHECK(seen == std::vector{std::pair{AccountNumber{"alice"}, Svc::service}});

   // positional arguments, an empty sender and packed arguments are read too
   back.clear();
   REQUIRE(ir::json_to_pssz(
               caller.types, run, psio::ijson{},
               chars(R"([{"sender":"","service":"svc","method":"credit","data":["bob",5,null]},7])"),
               back, nullptr, psio::json_parser::automatic, &handlers)
               .ok());
   inner.sender = AccountNumber{};
   CHECK(back == psio::method_args_to_pssz<Caller, 0>(inner, std::uint32_t{7}));
   back.clear();
   REQUIRE(ir::json_to_pssz(caller.types, run, psio::ijson{},
                            chars(R"({"action":{"sender":"","service":"other","method":"m",)"
                                  R"("rawData":"0102"},"delay":7})"),
                            back, nullptr, psio::json_parser::automatic, &handlers)
               .ok());
   Action raw{AccountNumber{}, AccountNumber{"other"}, MethodNumber{"m"}, {'\x01', '\x02'}};
   CHECK(back == psio::method_args_to_pssz<Caller, 0>(raw, std::uint32_t{7}));

   // an action of a service without a schema, or whose bytes are not its
   // arguments, is printed with rawData
   text.clear();
   const auto rawBytes = psio::method_args_to_pssz<Caller, 0>(raw, std::uint32_t{7});
   REQUIRE(ir::pssz_to_json(caller.types, run, psio::ijson{}, std::span<const char>{rawBytes}, text,
                            nullptr, &handlers)
               .ok());
   CHECK(text == R"({"action":{"sender":"","service":"other","method":"m","rawData":"0102"},"delay":7})");
   text.clear();
   inner.rawData = {'\x01'};
   const auto badBytes = psio::method_args_to_pssz<Caller, 0>(inner, std::uint32_t{7});
   REQUIRE(ir::pssz_to_json(caller.types, run, psio::ijson{}, std::span<const char>{badBytes}, text,
                            nullptr, &handlers)
               .ok());
   CHECK(text == R"({"action":{"sender":"","service":"svc","method":"credit","rawData":"01"},"delay":7})");

   // errors of the handler are the status of the walk
   back.clear();
   status = ir::json_to_pssz(
       caller.types, run, psio::ijson{},
       chars(R"({"action":{"sender":"","service":"svc","method":"nope","data":{}},"delay":7})"),
       back, nullptr, psio::json_parser::automatic, &handlers);
   REQUIRE(!status.ok());
   CHECK(std::string(status.error().what) == "Action not found: svc::nope");

   // a top-level action, as in postinstall.json
   auto act = toAction(PrettyAction{.sender  = "alice",
                                    .service = "caller",
                                    .method  = "run",
                                    .data    = psio::from_ijson<psio::json_value>(std::string_view{
                                        R"({"action":{"sender":"","service":"svc","method":"init","data":{}},"delay":1})"})},
                       schemas, handlers);
   CHECK(act.sender == AccountNumber{"alice"});
   CHECK(act.method == MethodNumber{"run"});
   CHECK(psio::to_hex(act.rawData) ==
         psio::to_hex(psio::method_args_to_pssz<Caller, 0>(
             Action{AccountNumber{}, Svc::service, MethodNumber{"init"}, psio::method_args_to_pssz<Svc, 2>()}, std::uint32_t{1})));
   // without data and rawData: no arguments
   CHECK(toAction(PrettyAction{.sender = "svc", .service = "svc", .method = "init"}, schemas,
                  handlers)
             .rawData == psio::method_args_to_pssz<Svc, 2>());

   // ServiceMethod
   const auto& watch      = *caller.actions.at("watch").params;
   const auto  watchBytes = psio::method_args_to_pssz<Caller, 1>(
       ServiceMethod{Svc::service, MethodNumber{"credit"}});
   text.clear();
   REQUIRE(ir::pssz_to_json(caller.types, watch, psio::ijson{}, std::span<const char>{watchBytes},
                            text, nullptr, &handlers)
               .ok());
   CHECK(text == R"({"target":{"service":"svc","method":"credit"}})");
   back.clear();
   REQUIRE(ir::json_to_pssz(caller.types, watch, psio::ijson{}, chars(text), back, nullptr,
                            psio::json_parser::automatic, &handlers)
               .ok());
   CHECK(back == watchBytes);
}

TEST_CASE("schema: comparison of row types and of whole schemas", "[schema]")
{
   psio::SchemaBuilder builder;
   const auto          note     = builder.insert<Note>();
   const auto          appended = builder.insert<NoteAppended>();
   const auto          changed  = builder.insert<NoteChanged>();
   const auto          renamed  = builder.insert<NoteRenamed>();
   const auto          row      = builder.insert<Row>();
   const auto          rowMore  = builder.insert<RowAppended>();
   const auto          rowText  = builder.insert<RowAppendedText>();
   const auto          types    = std::move(builder).build();

   // an appended optional member is an upgrade, not the reverse
   CHECK(ir::evolves_from(types, note, types, appended));
   CHECK(!ir::evolves_from(types, appended, types, note));
   CHECK(!ir::equivalent(types, note, types, appended));
   CHECK(ir::equivalent(types, note, types, note));
   // a changed member type is not
   auto bad = ir::evolves_from(types, note, types, changed);
   CHECK(!bad);
   CHECK(bad.path == ".text");
   CHECK(bad.code == "type-changed");
   // a renamed member: the same bytes, another contract
   CHECK(ir::evolves_from(types, note, types, renamed, ir::compare::wire));
   bad = ir::evolves_from(types, note, types, renamed);
   CHECK(!bad);
   CHECK(bad.code == "field-renamed");
   // a row of fixed-size members gains an optional one too
   CHECK(ir::evolves_from(types, row, types, rowMore));
   bad = ir::evolves_from(types, row, types, rowText);
   // ... but not one without a size bound: the offset width of the row is
   // inferred from its members (1 byte here) and would become 4
   CHECK(bad.code == "width-changed");

   // the same service built twice, and read back from its two encodings
   const auto a = ServiceSchema::make<Svc>();
   const auto b = psio::from_pssz<ServiceSchema>(psio::to_pssz(ServiceSchema::make<Svc>()));
   REQUIRE(a.actions.size() == b.actions.size());
   for (const auto& [name, type] : a.actions)
   {
      const auto& other = b.actions.at(name);
      CHECK(ir::equivalent(a.types, *type.params, b.types, *other.params));
      CHECK(type.result.has_value() == other.result.has_value());
      if (type.result && other.result)
         CHECK(ir::equivalent(a.types, **type.result, b.types, **other.result));
   }
   CHECK(ir::equivalent(a.types, a.database->at("service").at(0).type, b.types,
                        b.database->at("service").at(0).type));
   // names of types are not part of a type
   CHECK(ir::equivalent(a.types, *a.actions.at("init").params,
                        ServiceSchema::make<Caller>().types, st::AnyType{st::Object{
                            {}, {{"tuple", "named"}}}}));
}
