// What psibase derives from the methods a class reflects with PSIO_REFLECT:
// the packed argument tuple, action lookup by method number, the call
// proxies (transactor, ActionViewBuilder), the pack and template endpoints
// and the action / event part of the service schema. Runs natively and in a
// WASM guest.
#include <catch2/catch_all.hpp>

#include <psibase/Actor.hpp>
#include <psibase/MethodArgs.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/schema.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/servePackAction.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

using namespace psibase;

namespace methods_test
{
   struct Point
   {
      std::int32_t x = 0;
      std::string  label;
      PSIO_REFLECT(Point, x, label)
   };

   struct Ledger
   {
      static constexpr auto service = AccountNumber{"ledger"};

      void        init() {}
      std::string transfer(AccountNumber from, const std::string& memo, std::optional<std::int32_t> amount)
      {
         return from.str() + memo;
      }
      std::int32_t balance(AccountNumber who) const { return static_cast<std::int32_t>(who.value); }
      Point        locate(psio1::view<const Point> at, std::int32_t dx) const
      {
         return Point{at.x() + dx, std::string{std::string_view{at.label()}}};
      }
      std::int32_t unnamed(std::int32_t a, std::int32_t b) const { return a * b; }
      // A name that does not compress: it is addressed by its hash.
      std::int32_t get_staged_tx(std::int32_t id) const { return id; }

      struct Events
      {
         struct History
         {
            void noted(AccountNumber who, std::string text) {}
            void quiet(std::int32_t n) {}
         };
         struct Merkle
         {
            void sealed(std::uint64_t n) {}
         };
      };
   };
   PSIO_REFLECT(Ledger,
                method(init),
                method(transfer, from, memo, amount),
                method(balance, who),
                method(locate, at, dx),
                method(unnamed),
                method(get_staged_tx, id))
   PSIBASE_REFLECT_HISTORY_EVENTS(Ledger, method(noted, who, text), method(quiet, n))
   PSIBASE_REFLECT_MERKLE_EVENTS(Ledger, method(sealed, n))
   PSIBASE_PUBLIC_EVENT(Ledger::Events::History::noted)

   using TransferArgs = std::tuple<AccountNumber, std::string, std::optional<std::int32_t>>;
}  // namespace methods_test

using namespace methods_test;

TEST_CASE("methods: the packed argument tuple and result", "[methods]")
{
   static_assert(std::is_same_v<MethodArgs<decltype(&Ledger::init)>, std::tuple<>>);
   // By value: no references, no cv-qualifiers.
   static_assert(std::is_same_v<MethodArgs<decltype(&Ledger::transfer)>, TransferArgs>);
   // A view parameter is packed as the type it views.
   static_assert(
       std::is_same_v<MethodArgs<decltype(&Ledger::locate)>, std::tuple<Point, std::int32_t>>);
   static_assert(std::is_same_v<MethodArgs<decltype(&Ledger::Events::History::noted)>,
                                std::tuple<AccountNumber, std::string>>);

   static_assert(std::is_void_v<MethodResult<decltype(&Ledger::init)>>);
   static_assert(std::is_same_v<MethodResult<decltype(&Ledger::transfer)>, std::string>);
   static_assert(std::is_same_v<MethodResult<decltype(&Ledger::unnamed)>, std::int32_t>);

   static_assert(methodNumber<1, &Ledger::transfer> == MethodNumber{"transfer"});
   static_assert(methodNumber<0, &Ledger::Events::History::noted> == MethodNumber{"noted"});
   SUCCEED();
}

TEST_CASE("methods: an action is found by its method number", "[methods]")
{
   static_assert(findAction<Ledger>(MethodNumber{"init"}) == std::optional<std::size_t>{0});
   static_assert(findAction<Ledger>(MethodNumber{"locate"}) == std::optional<std::size_t>{3});
   static_assert(!findAction<Ledger>(MethodNumber{"missing"}));
   static_assert(!findAction<EmptyService>(MethodNumber{"init"}));

   std::size_t expected = 0;
   for (std::string_view name :
        {"init", "transfer", "balance", "locate", "unnamed", "get_staged_tx"})
   {
      CHECK(findAction<Ledger>(MethodNumber{name}) == std::optional<std::size_t>{expected});
      // The number alone identifies the action, however it was spelled.
      CHECK(findAction<Ledger>(MethodNumber{MethodNumber{name}.str()}) ==
            std::optional<std::size_t>{expected});
      ++expected;
   }
   // A hashed name is the hash of the whole name.
   CHECK(MethodNumber{"get_staged_tx"}.str().starts_with("#"));
   CHECK(!findAction<Ledger>(MethodNumber{"get_staged"}));
   CHECK(!findAction<Ledger>(MethodNumber{}));
   CHECK(!findAction<Ledger>(MethodNumber{"noted"}));
}

TEST_CASE("methods: transactor packs the arguments as the parameter tuple", "[methods]")
{
   const AccountNumber      alice{"alice"};
   const transactor<Ledger> ledger{alice, Ledger::service};

   const auto expected =
       psio1::convert_to_frac(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}});

   // lvalues, const lvalues, temporaries and convertible arguments
   const AccountNumber bob{"bob"};
   std::string         memo      = "rent";
   const std::string   constMemo = "rent";
   for (const Action& act :
        {ledger.transfer(bob, memo, 5), ledger.transfer(AccountNumber{"bob"}, constMemo, 5),
         ledger.transfer(bob, "rent", std::optional<std::int32_t>{5}),
         ledger.transfer(bob, std::string{"rent"}, std::int32_t{5})})
   {
      CHECK(act.sender == alice);
      CHECK(act.service == Ledger::service);
      CHECK(act.method == MethodNumber{"transfer"});
      CHECK(act.rawData == expected);
   }
   CHECK(memo == "rent");

   CHECK(ledger.init().rawData == psio1::convert_to_frac(std::tuple{}));
   CHECK(ledger.init().method == MethodNumber{"init"});
   CHECK(ledger.locate(Point{4, "here"}, 3).rawData ==
         psio1::convert_to_frac(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   CHECK(ledger.get_staged_tx(7).method == MethodNumber{"get_staged_tx"});
   CHECK(ledger.from(bob).balance(bob).sender == bob);
}

TEST_CASE("methods: ActionViewBuilder packs a whole action", "[methods]")
{
   const AccountNumber             alice{"alice"};
   const AccountNumber             bob{"bob"};
   const ActionViewBuilder<Ledger> ledger{alice, Ledger::service};
   const Action expected{alice, Ledger::service, MethodNumber{"transfer"},
                         psio1::convert_to_frac(TransferArgs{bob, "rent", std::int32_t{5}})};
   const auto   bytes = psio1::convert_to_frac(expected);
   auto         same  = [&](const auto& packed)
   {
      static_assert(std::is_same_v<decltype(packed),
                                   const psio1::shared_view_ptr<TypedAction<TransferArgs>>&>);
      auto data = packed.data_without_size_prefix();
      return std::vector<char>(data.begin(), data.end()) == bytes;
   };

   std::string memo = "rent";
   CHECK(same(ledger.transfer(bob, memo, 5)));
   CHECK(same(ledger.transfer(bob, "rent", std::optional<std::int32_t>{5})));
   CHECK(same(ledger.transfer(AccountNumber{"bob"}, std::string{"rent"}, std::int32_t{5})));
   CHECK(memo == "rent");
}

TEST_CASE("methods: packing an action from JSON", "[methods]")
{
   CHECK(fracpackActionFromJson<Ledger>("transfer", R"({"from":"bob","memo":"rent","amount":5})") ==
         psio1::convert_to_frac(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}}));
   // Arguments are matched by name, in any order; one that is absent keeps its default.
   CHECK(fracpackActionFromJson<Ledger>("transfer", R"({"memo":"rent","from":"bob"})") ==
         psio1::convert_to_frac(TransferArgs{AccountNumber{"bob"}, "rent", std::nullopt}));
   CHECK(fracpackActionFromJson<Ledger>("locate", R"({"dx":3,"at":{"x":4,"label":"here"}})") ==
         psio1::convert_to_frac(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   CHECK(fracpackActionFromJson<Ledger>("init", "{}") == psio1::convert_to_frac(std::tuple{}));
   // The action is named as it is written in the source.
   CHECK(!fracpackActionFromJson<Ledger>("missing", "{}"));
   CHECK(!fracpackActionFromJson<Ledger>("noted", "{}"));
}

TEST_CASE("methods: action templates", "[methods]")
{
   const auto json = generateActionJsonTemplate<Ledger>();
   CHECK(std::string(json.begin(), json.end()) ==
         R"({"init":{},)"
         R"("transfer":{"from":"","memo":"","amount":null},)"
         R"("balance":{"who":""},)"
         R"("locate":{"at":{"x":0,"label":""},"dx":0},)"
         R"("unnamed":{"error_missing_arg_name":0,"error_missing_arg_name":0},)"
         R"("get_staged_tx":{"id":0}})");
   const auto none = generateActionJsonTemplate<EmptyService>();
   CHECK(std::string(none.begin(), none.end()) == "{}");
}

TEST_CASE("methods: actions and events of the service schema", "[methods]")
{
   const auto schema = ServiceSchema::make<Ledger>();
   CHECK(schema.service == Ledger::service);

   std::vector<std::string> actions;
   for (const auto& [name, type] : schema.actions)
      actions.push_back(name + (type.result ? ":result" : ":void"));
   // Ordered by method number.
   std::vector<std::string> expected;
   {
      std::vector<std::pair<MethodNumber, std::string>> byNumber{
          {MethodNumber{"init"}, "init:void"},
          {MethodNumber{"transfer"}, "transfer:result"},
          {MethodNumber{"balance"}, "balance:result"},
          {MethodNumber{"locate"}, "locate:result"},
          {MethodNumber{"unnamed"}, "unnamed:result"},
          {MethodNumber{"get_staged_tx"}, "get_staged_tx:result"}};
      std::sort(byNumber.begin(), byNumber.end());
      for (auto& [_, text] : byNumber)
         expected.push_back(text);
   }
   CHECK(actions == expected);

   auto params = [&](const psio1::schema_types::AnyType& type)
   {
      std::string out;
      const auto* resolved = type.resolve(schema.types);
      REQUIRE(resolved);
      const auto* object = std::get_if<psio1::schema_types::Object>(&resolved->value);
      REQUIRE(object);
      for (const auto& member : object->members)
         out += member.name + " ";
      return out;
   };
   CHECK(params(schema.actions.at("init").params) == "");
   CHECK(params(schema.actions.at("transfer").params) == "from memo amount ");
   CHECK(params(schema.actions.at("locate").params) == "at dx ");
   // Parameters the reflection does not name are called by their position.
   CHECK(params(schema.actions.at("unnamed").params) == "c0 c1 ");

   REQUIRE(schema.history.size() == 2);
   CHECK(params(schema.history.at("noted").type) == "who text ");
   CHECK(schema.history.at("noted").access == "public");
   CHECK(params(schema.history.at("quiet").type) == "n ");
   CHECK(schema.history.at("quiet").access == "private");
   REQUIRE(schema.merkle.size() == 1);
   CHECK(params(schema.merkle.at("sealed").type) == "n ");
   CHECK(schema.merkle.at("sealed").access == "private");
}
