// What psibase derives from the methods a class reflects with PSIO_REFLECT:
// the packed argument tuple (PSSZ of psio::reflect<T>::method_arg_tuple<I>),
// action lookup by method number, dispatch over packed arguments, the call
// proxies (transactor, ActionViewBuilder), the pack and template endpoints
// and the action / event part of the service schema; and the packed
// transaction a SignedTransaction holds. Runs natively and in a WASM guest
// (the dispatcher itself natively only: it needs a host).
#include <catch2/catch_all.hpp>

#include <psibase/Actor.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/schema.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/servePackAction.hpp>

#include <psio/to_hex.hpp>

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
      Point        locate(psio::pssz_view<Point> at, std::int32_t dx) const
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
   using R = psio::reflect<Ledger>;
   static_assert(std::is_same_v<R::method_arg_tuple<0>::tuple_type, std::tuple<>>);
   // By value: no references, no cv-qualifiers.
   static_assert(std::is_same_v<R::method_arg_tuple<1>::tuple_type, TransferArgs>);
   // A view parameter is packed as the type it views.
   static_assert(
       std::is_same_v<R::method_arg_tuple<3>::tuple_type, std::tuple<Point, std::int32_t>>);
   static_assert(
       std::is_same_v<psio::reflect<Ledger::Events::History>::method_arg_tuple<0>::tuple_type,
                      std::tuple<AccountNumber, std::string>>);

   static_assert(std::is_void_v<MethodResult<Ledger, 0>>);
   static_assert(std::is_same_v<MethodResult<Ledger, 1>, std::string>);
   static_assert(std::is_same_v<MethodResult<Ledger, 4>, std::int32_t>);

   static_assert(methodNumber<1, &Ledger::transfer> == MethodNumber{"transfer"});
   static_assert(methodNumber<0, &Ledger::Events::History::noted> == MethodNumber{"noted"});

   // No argument list declares a cap: the bytes are those of the plain tuple.
   CHECK(psio::to_pssz(R::method_arg_tuple<1>{AccountNumber{"bob"}, "rent", std::int32_t{5}}) ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}}));
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
       psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}});

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

   CHECK(ledger.init().rawData == psio::to_pssz(std::tuple{}));
   CHECK(ledger.init().method == MethodNumber{"init"});
   CHECK(ledger.locate(Point{4, "here"}, 3).rawData ==
         psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   CHECK(ledger.get_staged_tx(7).method == MethodNumber{"get_staged_tx"});
   CHECK(ledger.from(bob).balance(bob).sender == bob);
}

TEST_CASE("methods: ActionViewBuilder packs a whole action", "[methods]")
{
   const AccountNumber             alice{"alice"};
   const AccountNumber             bob{"bob"};
   const ActionViewBuilder<Ledger> ledger{alice, Ledger::service};
   const Action expected{alice, Ledger::service, MethodNumber{"transfer"},
                         psio::to_pssz(TransferArgs{bob, "rent", std::int32_t{5}})};
   const auto   bytes = psio::to_pssz(expected);
   auto         same  = [&](const auto& packed)
   {
      static_assert(
          std::is_same_v<decltype(packed),
                         const psio::pssz_buffer<
                             TypedAction<psio::reflect<Ledger>::method_arg_tuple<1>>>&>);
      auto data = packed.bytes();
      return std::vector<char>(data.begin(), data.end()) == bytes;
   };

   std::string memo = "rent";
   CHECK(same(ledger.transfer(bob, memo, 5)));
   CHECK(same(ledger.transfer(bob, "rent", std::optional<std::int32_t>{5})));
   CHECK(same(ledger.transfer(AccountNumber{"bob"}, std::string{"rent"}, std::int32_t{5})));
   CHECK(memo == "rent");

   // The packed action is read through its view; rawData is typed.
   auto packed = ledger.transfer(bob, memo, 5);
   CHECK(packed->sender() == alice);
   CHECK(packed->method() == MethodNumber{"transfer"});
   CHECK(std::get<1>(packed->rawData()->unpack()) == "rent");
   // The caller owns the bytes: a fixed-size argument is overwritten in place.
   {
      auto                   locate = ledger.locate(Point{4, "here"}, 3);
      (*psio::as_mutable_view(locate).rawData()).template get<1>() = 8;
      CHECK(std::ranges::equal(
          locate.bytes(),
          psio::to_pssz(Action{alice, Ledger::service, MethodNumber{"locate"},
                               psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{8}})})));
   }
   // A view as an argument is packed as the value it designates.
   const auto                   point = psio::to_pssz(Point{4, "here"});
   const psio::pssz_view<Point> pointView{point};
   CHECK(transactor<Ledger>{alice, Ledger::service}.locate(pointView, 3).rawData ==
         psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}}));
}

namespace methods_test
{
   // What the dispatcher is given: views, borrowed text and values.
   struct Disp
   {
      std::string log;

      std::int32_t look(psio::pssz_view<const Point> at, std::int32_t dx, std::string_view note)
      {
         log = std::string{std::string_view{at.label()}} + "/" + std::string{note};
         return at.x() + dx;
      }
      void                   store(Point p, const std::string& name) { log = p.label + "=" + name; }
      psio::pssz_view<Point> echo(psio::pssz_view<Point> p) { return p; }
   };
   PSIO_REFLECT(Disp, method(look, at, dx, note), method(store, p, name), method(echo, p))
}  // namespace methods_test

TEST_CASE("methods: a method is called with packed arguments", "[methods][dispatch]")
{
   using R = psio::reflect<Disp>;
   static_assert(std::is_same_v<R::method_arg_tuple<0>::tuple_type,
                                std::tuple<Point, std::int32_t, std::string>>);
   static_assert(std::is_same_v<R::method_params<0>,
                                std::tuple<psio::pssz_view<Point>, std::int32_t, std::string_view>>);

   const auto look  = psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}, std::string{"n"}});
   const auto store = psio::to_pssz(std::tuple{Point{1, "p"}, std::string{"nm"}});
   // What the callers produce is what the dispatcher reads.
   CHECK(psio::method_args_to_pssz<Disp, 0>(Point{4, "here"}, 3, "n") == look);

   Disp disp;
   REQUIRE(psio::validate_method_args<Disp, 0>(look).ok());
   std::vector<char> result;
   REQUIRE(psio::call_method_pssz<Disp, 0>(disp, psio::trusted{look}, result).ok());
   CHECK(result == psio::to_pssz(std::int32_t{7}));
   CHECK(disp.log == "here/n");

   REQUIRE(psio::validate_method_args<Disp, 1>(store).ok());
   result.clear();
   REQUIRE(psio::call_method_pssz<Disp, 1>(disp, psio::trusted{store}, result).ok());
   CHECK(result.empty());
   CHECK(disp.log == "p=nm");

   // A returned view is packed as the value it designates.
   const auto echo = psio::to_pssz(std::tuple{Point{9, "e"}});
   result.clear();
   REQUIRE(psio::call_method_pssz<Disp, 2>(disp, psio::trusted{echo}, result).ok());
   CHECK(result == psio::to_pssz(Point{9, "e"}));

   // Malformed arguments are refused before the method runs, with a reason:
   // no bytes, too few for the offsets, cut inside the first argument, and
   // the arguments of another method.
   for (const std::vector<char>& bad :
        {std::vector<char>{}, std::vector<char>{1, 2, 3},
         std::vector<char>(look.begin(), look.begin() + 20), store})
   {
      auto status = psio::validate_method_args<Disp, 0>(bad);
      REQUIRE(!status.ok());
      CHECK(!status.error().what.empty());
   }
}

#ifndef COMPILING_WASM
// The host half of the dispatcher, for the native test.
namespace
{
   std::vector<char> retval;
   bool              retvalSet = false;
}  // namespace
void psibase::raw::setRetval(const char* data, std::uint32_t len)
{
   retval.assign(data, data + len);
   retvalSet = true;
}

TEST_CASE("methods: dispatch of an action", "[methods][dispatch]")
{
   auto action = [](std::string_view method, std::vector<char> args)
   {
      return psio::shared_pssz<Action>{Action{AccountNumber{"alice"}, AccountNumber{"disp"},
                                              MethodNumber{method}, std::move(args)}};
   };
   auto run = [&](std::string_view method, std::vector<char> args, Disp& disp)
   {
      retval.clear();
      retvalSet  = false;
      auto act   = action(method, std::move(args));
      auto index = findAction<Disp>(act->method().unpack());
      REQUIRE(index.has_value());
      psibase::detail::ActionTable<Disp>::calls[*index](disp, act);
   };

   Disp disp;
   run("look", psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}, std::string{"n"}}), disp);
   CHECK(retvalSet);
   CHECK(retval == psio::to_pssz(std::int32_t{7}));
   CHECK(disp.log == "here/n");

   run("store", psio::to_pssz(std::tuple{Point{1, "p"}, std::string{"nm"}}), disp);
   CHECK(!retvalSet);
   CHECK(disp.log == "p=nm");

   run("echo", psio::to_pssz(std::tuple{Point{9, "e"}}), disp);
   CHECK(retval == psio::to_pssz(Point{9, "e"}));

   // Malformed arguments: the action aborts with a message that names the
   // method, and the method does not run.
   disp.log = "untouched";
   CHECK_THROWS_WITH(run("look", std::vector<char>{1, 2, 3}, disp),
                     Catch::Matchers::StartsWith("invalid argument encoding for look: "));
   CHECK_THROWS_WITH(run("look", psio::to_pssz(std::tuple{Point{1, "p"}, std::string{"nm"}}), disp),
                     Catch::Matchers::StartsWith("invalid argument encoding for look: "));
   CHECK(disp.log == "untouched");
   CHECK(!retvalSet);
}
#endif

namespace methods_test
{
   struct Twin
   {
      std::vector<char>                             transaction;
      std::vector<std::vector<char>>                proofs;
      std::optional<std::vector<std::vector<char>>> subjectiveData;
      PSIO_REFLECT(Twin, transaction, proofs, subjectiveData)
   };
}  // namespace methods_test

TEST_CASE("methods: the bytes of an action", "[methods][transaction]")
{
   // What the host hands to a service and a service to the host: the same
   // bytes natively and in a guest.
   const Action act{AccountNumber{1}, AccountNumber{2}, MethodNumber{3}, {1, 2, 3}};
   const auto   bytes = psio::to_pssz(act);
   CHECK(psio::to_hex(std::span<const char>{bytes}) ==
         "1C000000"            // the record's fixed part is 28 bytes
         "0100000000000000"    // sender
         "0200000000000000"    // service
         "0300000000000000"    // method
         "1C000000"            // rawData starts after the fixed part
         "010203");
   CHECK(psio::validate_pssz<Action>(bytes).ok());
   // What the node hands to x-http::serve
   {
      HttpRequest req{.host = "h", .method = "GET", .target = "/", .contentType = "t",
                      .headers = {{"n", "v"}}, .body = {1, 2}};
      const auto packed = psio::to_pssz(std::tuple(std::int32_t{7}, req));
      INFO(psio::to_hex(std::span<const char>{packed}));
      CHECK(psio::to_hex(std::span<const char>{packed}) ==
            "0800000007000000080000001800000018000000190000001C0000001D0000001E0000002C00000068"
            "4745542F740400000008000000090000006E760102");
      auto status = psio::validate_pssz<std::tuple<std::int32_t, HttpRequest>>(packed);
      INFO(std::string(status.ok() ? std::string_view{} : status.error().what));
      CHECK(status.ok());
   }
   // The check a service makes on the action it is handed (a guest
   // without exceptions cannot use psio::validate_strict for this type).
   bool unknown = true;
   CHECK(psio::validate_pssz_compatible<Action>(psio::pssz{}, bytes, unknown).ok());
   CHECK(!unknown);
}

TEST_CASE("methods: a signed transaction holds its transaction packed", "[methods][transaction]")
{
   Transaction trx;
   trx.tapos.refBlockSuffix = 0x01020304;
   trx.actions.push_back(Action{AccountNumber{"alice"}, AccountNumber{"tokens"},
                                MethodNumber{"credit"}, {1, 2, 3}});
   trx.claims.push_back(Claim{AccountNumber{"verify-sig"}, {9, 8}});
   const auto trxBytes = psio::to_pssz(trx);

   const SignedTransaction signedTrx{psio::shared_pssz<Transaction>{trx}, {{7, 7}}, {}};
   // The member is the bytes of a byte list that holds the PSSZ of the
   // transaction: a record with a std::vector<char> member in its place
   // has the same bytes.
   const auto bytes = psio::to_pssz(signedTrx);
   CHECK(bytes == psio::to_pssz(Twin{trxBytes, {{7, 7}}, {}}));
   // The transaction's bytes are what is hashed for its id.
   CHECK(std::ranges::equal(signedTrx.transaction.bytes(), trxBytes));
   CHECK(sha256(signedTrx.transaction.data(), signedTrx.transaction.size()) == sha256(trx));

   // Read through the member, without unpacking.
   CHECK(signedTrx.transaction->tapos().refBlockSuffix() == 0x01020304);
   CHECK(signedTrx.transaction->actions().size() == 1);
   CHECK(signedTrx.transaction->actions()[0].sender() == AccountNumber{"alice"});
   CHECK(signedTrx.transaction->claims()[0].service() == AccountNumber{"verify-sig"});
   CHECK(signedTrx.transaction.unpack().actions[0].rawData == std::vector<char>{1, 2, 3});

   // A copy shares the bytes.
   const SignedTransaction copy = signedTrx;
   CHECK(copy.transaction.data() == signedTrx.transaction.data());
   CHECK(copy.transaction == signedTrx.transaction);

   // Decoding validates the member as a Transaction and adopts its bytes.
   REQUIRE(psio::validate_pssz<SignedTransaction>(bytes).ok());
   const auto decoded = psio::from_pssz<SignedTransaction>(bytes);
   CHECK(decoded.transaction == signedTrx.transaction);
   CHECK(decoded.proofs == signedTrx.proofs);
   CHECK(psio::pssz_view<SignedTransaction>{bytes}.transaction()->actions()[0].method() ==
         MethodNumber{"credit"});
   // Bytes that are not a transaction are not a signed transaction.
   CHECK(!psio::validate_pssz<SignedTransaction>(
              psio::to_pssz(Twin{std::vector<char>{1, 2, 3}, {{7, 7}}, {}}))
              .ok());
}

TEST_CASE("methods: packing an action from JSON", "[methods]")
{
   CHECK(fracpackActionFromJson<Ledger>("transfer", R"({"from":"bob","memo":"rent","amount":5})") ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}}));
   // Arguments are matched by name, in any order; one that is absent keeps its default.
   CHECK(fracpackActionFromJson<Ledger>("transfer", R"({"memo":"rent","from":"bob"})") ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::nullopt}));
   CHECK(fracpackActionFromJson<Ledger>("locate", R"({"dx":3,"at":{"x":4,"label":"here"}})") ==
         psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   CHECK(fracpackActionFromJson<Ledger>("init", "{}") == psio::to_pssz(std::tuple{}));
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
