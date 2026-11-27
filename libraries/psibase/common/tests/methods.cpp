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
#include <psibase/nativeTables.hpp>
#include <psibase/schema.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/trace.hpp>

#include <psio/to_hex.hpp>

#include <algorithm>
#include <chrono>
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

   // An Action with an appended member
   struct ActionPlus
   {
      AccountNumber              sender;
      AccountNumber              service;
      MethodNumber               method;
      std::vector<char>          rawData;
      std::optional<std::string> extra;
      PSIO_REFLECT(ActionPlus, sender, service, method, rawData, extra)
   };
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

   static_assert(std::is_void_v<psio::method_result_t<Ledger, 0>>);
   static_assert(std::is_same_v<psio::method_result_t<Ledger, 1>, std::string>);
   static_assert(std::is_same_v<psio::method_result_t<Ledger, 4>, std::int32_t>);

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
   // A service that is handed actions: a call inside a call.
   struct Runner
   {
      static constexpr auto service = AccountNumber{"runner"};

      std::uint64_t post(std::uint8_t mode, Action action, std::uint32_t maxTime, MethodNumber callback)
      {
         return mode;
      }
      void relay(const Action& action) {}
      void store(psio::pssz_view<Point> at, std::vector<char> data) {}
   };
   PSIO_REFLECT(Runner,
                method(post, mode, action, maxTime, callback),
                method(relay, action),
                method(store, at, data))

   // What a call wrote before its arguments were packed in place: the
   // arguments, then the action around them.
   template <typename T, std::size_t I, typename... Args>
   Action twoStep(AccountNumber sender, AccountNumber service, Args&&... args)
   {
      return Action{sender, service, MethodNumber{psio::reflect<T>::template method_name<I>},
                    psio::method_args_to_pssz<T, I>(std::forward<Args>(args)...)};
   }
}  // namespace methods_test

// A call is packed into one buffer (psio::method_args_packed). The bytes
// are those of the two-step encoding, for every proxy that packs a call.
TEST_CASE("methods: a call packed in place has the bytes of the two-step encoding", "[methods]")
{
   const AccountNumber alice{"alice"};
   const AccountNumber bob{"bob"};
   std::string         memo = "rent";

   const LazyActionBuilder<Ledger> lazyLedger{alice, Ledger::service};
   const LazyActionBuilder<Runner> lazyRunner{alice, Runner::service};
   const ActionViewBuilder<Runner> runner{alice, Runner::service};
   auto equal = [](const auto& packed, const Action& expected)
   { return std::ranges::equal(packed.bytes(), psio::to_pssz(expected)); };

   SECTION("an action that is not packed yet")
   {
      auto lazy = lazyLedger.transfer(bob, memo, 5);
      static_assert(psio::packs_as<decltype(lazy), Action>);
      const auto expected = twoStep<Ledger, 1>(alice, Ledger::service, bob, memo, 5);
      CHECK(psio::to_pssz(lazy) == psio::to_pssz(expected));
      CHECK(psio::pssz_size(lazy) == psio::to_pssz(expected).size());
      CHECK(psio::validate_strict<Action>(psio::pssz{}, psio::to_pssz(lazy)).ok());
      // An lvalue argument is referred to: the action is what it is when packed.
      memo = "food";
      CHECK(psio::to_pssz(lazy) ==
            psio::to_pssz(twoStep<Ledger, 1>(alice, Ledger::service, bob, "food", 5)));
      CHECK(psio::to_pssz(lazyLedger.init()) ==
            psio::to_pssz(twoStep<Ledger, 0>(alice, Ledger::service)));
      // A view argument, a hashed method name
      const auto                   point = psio::to_pssz(Point{4, "here"});
      const psio::pssz_view<Point> pointView{point};
      CHECK(psio::to_pssz(lazyLedger.locate(pointView, 3)) ==
            psio::to_pssz(twoStep<Ledger, 3>(alice, Ledger::service, Point{4, "here"}, 3)));
      CHECK(psio::to_pssz(lazyLedger.get_staged_tx(7)) ==
            psio::to_pssz(twoStep<Ledger, 5>(alice, Ledger::service, 7)));
      // To a method it is the Action it stands for: the argument list of
      // a method that takes an action is declared with Action.
      static_assert(std::is_same_v<psio::reflect<Runner>::method_arg_tuple<1>::tuple_type,
                                   std::tuple<Action>>);
      static_assert(psio::method_arguments<Runner, 1, decltype(lazy)>);
   }

   SECTION("a call inside a call inside a call")
   {
      const MethodNumber callback{"onDone"};
      const Action       transfer = twoStep<Ledger, 1>(alice, Ledger::service, bob, memo, 5);
      const Action       post =
          twoStep<Runner, 0>(alice, Runner::service, std::uint8_t{2}, transfer, 1000, callback);
      const Action relay = twoStep<Runner, 1>(alice, Runner::service, post);

      // An owning action as the argument, as before
      CHECK(equal(runner.post(std::uint8_t{2}, transfer, 1000, callback), post));
      CHECK(equal(runner.relay(post), relay));
      // The same calls from actions that are not packed
      CHECK(equal(runner.post(std::uint8_t{2}, lazyLedger.transfer(bob, memo, 5), 1000, callback),
                  post));
      CHECK(equal(runner.relay(lazyRunner.post(std::uint8_t{2}, lazyLedger.transfer(bob, memo, 5),
                                               1000, callback)),
                  relay));
      // transactor takes them too
      CHECK(transactor<Runner>{alice, Runner::service}
                .relay(lazyRunner.post(std::uint8_t{2}, lazyLedger.transfer(bob, memo, 5), 1000,
                                       callback))
                .rawData == relay.rawData);
   }

   SECTION("a large argument")
   {
      const std::vector<char>      data(1 << 20, 'x');
      const auto                   point = psio::to_pssz(Point{4, "here"});
      const psio::pssz_view<Point> at{point};
      const Action  store = twoStep<Runner, 2>(alice, Runner::service, at, data);
      const Action  relay = twoStep<Runner, 1>(alice, Runner::service, store);
      auto          direct = runner.relay(lazyRunner.store(at, data));
      CHECK(direct.size() == psio::to_pssz(relay).size());
      CHECK(equal(direct, relay));
      CHECK(equal(runner.store(at, data), store));
   }

   SECTION("the action that emits an event")
   {
      const EventEmitterProxy emitter{alice, EventDb::historyEvent};
      const Action            expected{
          alice, AccountNumber{"events"}, MethodNumber{"event"},
          psio::to_pssz(std::tuple(
              EventDb::historyEvent, MethodNumber{"noted"},
              psio::method_args_to_pssz<Ledger::Events::History, 0>(bob, memo)))};
      CHECK(emitter.pack<0, &Ledger::Events::History::noted>(bob, memo) == psio::to_pssz(expected));
      CHECK(emitter.pack<0, &Ledger::Events::History::noted>(AccountNumber{"bob"},
                                                             std::string{"rent"}) ==
            psio::to_pssz(expected));
      const EventEmitterProxy merkle{bob, EventDb::merkleEvent};
      CHECK(merkle.pack<0, &Ledger::Events::Merkle::sealed>(7) ==
            psio::to_pssz(Action{
                bob, AccountNumber{"events"}, MethodNumber{"event"},
                psio::to_pssz(std::tuple(
                    EventDb::merkleEvent, MethodNumber{"sealed"},
                    psio::method_args_to_pssz<Ledger::Events::Merkle, 0>(std::uint64_t{7})))}));
   }

   SECTION("a reply whose body is packed in place")
   {
      const Point point{4, "here"};
      auto        body = psio::packed(point);
      const BasicHttpReply<decltype(body)> source{.contentType = "application/octet-stream",
                                                  .body        = std::move(body),
                                                  .headers     = {{"Vary", "Origin"}}};
      static_assert(psio::packs_as<decltype(source), HttpReply>);
      const HttpReply reply{.contentType = "application/octet-stream",
                            .body        = psio::to_pssz(point),
                            .headers     = {{"Vary", "Origin"}}};
      CHECK(psio::to_pssz(source) == psio::to_pssz(reply));
   }

   SECTION("a reply whose body is JSON text written in place")
   {
      // r-transact sendReply: the text of the trace is written into the
      // reply, the reply into the action.
      TransactionTrace trace;
      auto&            at  = trace.actionTraces.emplace_back();
      at.action            = Action{alice, bob, MethodNumber{"move"}, {'\x01', '\xfe', '\x00'}};
      at.rawRetval         = {'\x7f'};
      at.totalTime         = std::chrono::nanoseconds{1234567};
      at.innerTraces.push_back({ConsoleTrace{"line \"one\"\n"}});
      at.innerTraces.push_back({ActionTrace{.action = Action{bob, alice, MethodNumber{"look"}, {}}}});
      trace.error = "failed: \\ \u00e9";

      const auto text = psio::to_ijson(trace);
      auto       body = psio::ijson_of(trace);
      REQUIRE(body.check().ok());
      CHECK(body.size() == text.size());
      CHECK(psio::ijson_size(trace) == text.size());
      const BasicHttpReply<decltype(body)> source{.contentType = "application/json",
                                                  .body        = std::move(body),
                                                  .headers     = {{"Vary", "Origin"}}};
      static_assert(psio::packs_as<decltype(source), HttpReply>);
      const HttpReply reply{.contentType = "application/json",
                            .body        = std::vector<char>(text.begin(), text.end()),
                            .headers     = {{"Vary", "Origin"}}};
      CHECK(psio::to_pssz(source) == psio::to_pssz(reply));
      // and as the argument of a call
      CHECK(psio::to_pssz(std::tuple<std::int32_t, const decltype(source)&>(7, source)) ==
            psio::to_pssz(std::tuple<std::int32_t, const HttpReply&>(7, reply)));

      // A trace with a string that is not UTF-8 has no text: the source
      // says so before anything is packed.
      trace.error = "\xff";
      CHECK(!psio::ijson_of(trace).check().ok());
   }
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
      auto index = findAction<Disp>(act->method());
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
   // The check a service makes on the action it is handed: valid,
   // canonical, nothing unknown. The same answers natively and in a guest.
   CHECK(psio::validate_strict<Action>(psio::pssz{}, bytes).ok());
   {
      // An appended member this build does not know: compatible, not strict.
      const auto wider = psio::to_pssz(
          ActionPlus{AccountNumber{"alice"}, AccountNumber{"ledger"}, MethodNumber{"transfer"}, {1}, "x"});
      CHECK(psio::validate_pssz<Action>(wider).ok());
      auto status = psio::validate_strict<Action>(psio::pssz{}, wider);
      CHECK(!status.ok());
   }
}

// A view converts to what it designates when that is trivially copyable and
// of fixed size, and a view of bytes to a span: no unpack() at a call.
static_assert(std::is_trivially_copyable_v<AccountNumber>);
static_assert(std::is_trivially_copyable_v<MethodNumber>);
static_assert(std::is_trivially_copyable_v<Checksum256>);
static_assert(std::is_convertible_v<psio::pssz_view<AccountNumber>, AccountNumber>);
static_assert(std::is_convertible_v<psio::pssz_view<MethodNumber>, MethodNumber>);
static_assert(std::is_convertible_v<psio::pssz_view<Checksum256>, Checksum256>);
static_assert(std::is_convertible_v<psio::pssz_view<TimePointSec>, TimePointSec>);
static_assert(std::is_convertible_v<psio::pssz_view<std::vector<unsigned char>>,
                                    std::span<const unsigned char>>);
static_assert(std::is_convertible_v<psio::pssz_view<std::vector<char>>, std::span<const char>>);
// A conversion that allocates is spelled.
static_assert(!std::is_convertible_v<psio::pssz_view<std::vector<char>>, std::vector<char>>);
static_assert(!std::is_convertible_v<psio::pssz_view<Action>, Action>);

TEST_CASE("methods: members of a packed action convert without unpack", "[methods][views]")
{
   const Action action{AccountNumber{"alice"}, AccountNumber{"ledger"}, MethodNumber{"transfer"},
                       {1, 2, 3}};
   const auto              bytes = psio::to_pssz(action);
   psio::pssz_view<Action> view{bytes};
   auto who  = [](AccountNumber a) { return a; };
   auto what = [](MethodNumber m) { return m; };
   auto raw  = [](std::span<const char> b) { return b.size(); };
   CHECK(who(view.sender()) == action.sender);
   CHECK(what(view.method()) == action.method);
   CHECK(raw(view.rawData()) == 3);
   ServiceMethod sm{view.service(), view.method()};
   CHECK(sm.service == action.service);
}

// The error callback x-http calls for a request or a handshake:
// (socket, optional<HttpReply>) under maxDynamicData(0xffffffff), as
// XProxy::onError and XPeers::errP2P declare it. Under the same cap
// (socket) alone is that call without a reply; without a cap it is not
// (1-byte offsets against 4-byte ones).
namespace methods_test
{
   struct ErrorCallbacks
   {
      void capped(std::int32_t socket) {}
      void plain(std::int32_t socket) {}
      void onError(std::int32_t socket, std::optional<HttpReply> reply) {}
   };
   PSIO_REFLECT(ErrorCallbacks,
                method(capped, socket, maxDynamicData(0xffffffff)),
                method(plain, socket),
                method(onError, socket, reply, maxDynamicData(0xffffffff)))
   using CappedArgs  = psio::reflect<ErrorCallbacks>::method_arg_tuple<0>;
   using PlainArgs   = psio::reflect<ErrorCallbacks>::method_arg_tuple<1>;
   using OnErrorArgs = psio::reflect<ErrorCallbacks>::method_arg_tuple<2>;
}  // namespace methods_test
static_assert(psio::auto_pssz_width_v<OnErrorArgs> == 4);
static_assert(psio::auto_pssz_width_v<PlainArgs> == 1);
static_assert(psio::pssz_evolves_from<CappedArgs, OnErrorArgs>);
static_assert(!psio::pssz_evolves_from<PlainArgs, OnErrorArgs>);

TEST_CASE("methods: the error callback's argument list keeps its width", "[methods][evolution]")
{
   psio::require_pssz_evolves_from<CappedArgs, OnErrorArgs>();
   const std::int32_t socket = 7;
   const auto one  = psio::method_args_to_pssz<ErrorCallbacks, 0>(socket);
   const auto none = psio::method_args_to_pssz<ErrorCallbacks, 2>(socket, std::nullopt);
   CHECK(one == none);
   CHECK(psio::to_hex(std::span<const char>{none}) == "0400000007000000");
   // What x-http packs when a socket closes before a reply.
   CHECK(psio::to_pssz(std::tuple(socket, std::optional<HttpReply>{})) == none);
   CHECK(psio::validate_method_args<ErrorCallbacks, 2>(one).ok());
   // The uncapped one-argument list is another encoding.
   const auto plain = psio::method_args_to_pssz<ErrorCallbacks, 1>(socket);
   CHECK(psio::to_hex(std::span<const char>{plain}) == "0407000000");
   CHECK(!psio::validate_method_args<ErrorCallbacks, 2>(plain).ok());
   CHECK(!psio::validate_method_args<ErrorCallbacks, 1>(none).ok());
}

TEST_CASE("methods: a signed transaction holds its transaction packed", "[methods][transaction]")
{
   Transaction trx;
   trx.tapos.refBlockSuffix = 0x01020304;
   trx.actions.push_back(Action{AccountNumber{"alice"}, AccountNumber{"tokens"},
                                MethodNumber{"credit"}, {1, 2, 3}});
   trx.claims.push_back(Claim{AccountNumber{"verify-k1"}, {9, 8}});
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
   CHECK(signedTrx.transaction->claims()[0].service() == AccountNumber{"verify-k1"});
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
   // An object keyed by parameter name ...
   CHECK(packActionFromJson<Ledger>("transfer", R"({"from":"bob","memo":"rent","amount":5})") ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}}));
   // ... in any order; an optional argument may be left out; a member that
   // names no parameter is skipped.
   CHECK(packActionFromJson<Ledger>("transfer", R"({"memo":"rent","from":"bob"})") ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::nullopt}));
   CHECK(
       packActionFromJson<Ledger>("transfer", R"({"memo":"rent","note":{"x":[1]},"from":"bob"})") ==
       psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::nullopt}));
   CHECK(packActionFromJson<Ledger>("locate", R"({"dx":3,"at":{"x":4,"label":"here"}})") ==
         psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   // Or the positional array, one element per parameter.
   CHECK(packActionFromJson<Ledger>("transfer", R"(["bob","rent",5])") ==
         psio::to_pssz(TransferArgs{AccountNumber{"bob"}, "rent", std::int32_t{5}}));
   CHECK(packActionFromJson<Ledger>("locate", R"([{"x":4,"label":"here"},3])") ==
         psio::to_pssz(std::tuple{Point{4, "here"}, std::int32_t{3}}));
   // Parameters the reflection does not name: the array only.
   CHECK(packActionFromJson<Ledger>("unnamed", "[6,7]") ==
         psio::to_pssz(std::tuple{std::int32_t{6}, std::int32_t{7}}));
   CHECK(packActionFromJson<Ledger>("init", "{}") == psio::to_pssz(std::tuple{}));
   CHECK(packActionFromJson<Ledger>("init", "[]") == psio::to_pssz(std::tuple{}));
   // The action is named as it is written in the source.
   CHECK(!packActionFromJson<Ledger>("missing", "{}"));
   CHECK(!packActionFromJson<Ledger>("noted", "{}"));

   // What the endpoint refuses (it aborts with the action's name and this
   // message): the reader is PSIO's, over the argument list.
   using Transfer = psio::reflect<Ledger>::method_arg_tuple<1>;
   auto refusal   = [](std::string_view json)
   {
      Transfer args{};
      auto     status = psio::decode_json_checked(
          psio::ijson{}, std::span<const char>{json.data(), json.size()}, args);
      return status.ok() ? std::string{} : std::string{status.error().what};
   };
   CHECK(refusal(R"({"from":"bob","memo":"rent"})") == "");
   // A required argument that is missing is named.
   CHECK(refusal(R"({"from":"bob"})") == R"(json: missing required member "memo")");
   CHECK(refusal(R"({"memo":"rent","amount":5})") == R"(json: missing required member "from")");
   CHECK(refusal(R"(["bob","rent"])") != "");
   CHECK(refusal(R"(["bob","rent",5,6])") != "");
   // A 32-bit number is a number, an account name is canonical.
   CHECK(refusal(R"({"from":"bob","memo":"rent","amount":"5"})") != "");
   CHECK(refusal(R"({"from":"Bob","memo":"rent"})") == "AccountNumber: not an account name");
}

TEST_CASE("methods: action templates", "[methods]")
{
   const auto json = generateActionJsonTemplate<Ledger>();
   CHECK(std::string(json.begin(), json.end()) ==
         R"({"init":{},)"
         R"("transfer":{"from":"","memo":"","amount":null},)"
         R"("balance":{"who":""},)"
         R"("locate":{"at":{"x":0,"label":""},"dx":0},)"
         R"("unnamed":[0,0],)"
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
   // Ordered by name.
   std::vector<std::string> expected{"balance:result",  "get_staged_tx:result", "init:void",
                                     "locate:result",   "transfer:result",      "unnamed:result"};
   CHECK(actions == expected);

   auto params = [&](const psio::schema_types::AnyType& type)
   {
      std::string out;
      const auto* resolved = type.resolve(schema.types);
      REQUIRE(resolved);
      const auto* object = std::get_if<psio::schema_types::Object>(&resolved->value);
      REQUIRE(object);
      for (const auto& member : object->members)
         out += member.name + " ";
      for (const auto& attribute : object->attributes)
         if (attribute.name == "tuple")
            out += "(" + attribute.value.value_or("") + ")";
      return out;
   };
   CHECK(params(*schema.actions.at("init").params) == "(named)");
   CHECK(params(*schema.actions.at("transfer").params) == "from memo amount (named)");
   CHECK(params(*schema.actions.at("locate").params) == "at dx (named)");
   // Parameters the reflection does not name are positional.
   CHECK(params(*schema.actions.at("unnamed").params) == "0 1 (positional)");
   // An action is found by its number, a hashed name included.
   REQUIRE(schema.findAction(MethodNumber{"get_staged_tx"}));
   CHECK(schema.findAction(MethodNumber{"get_staged_tx"})->first == "get_staged_tx");
   CHECK(!schema.findAction(MethodNumber{"get_staged"}));

   REQUIRE(schema.history.size() == 2);
   CHECK(params(schema.history.at("noted").type) == "who text (named)");
   CHECK(schema.history.at("noted").access == "public");
   CHECK(params(schema.history.at("quiet").type) == "n (named)");
   CHECK(schema.history.at("quiet").access == "private");
   REQUIRE(schema.merkle.size() == 1);
   CHECK(params(schema.merkle.at("sealed").type) == "n (named)");
   CHECK(schema.merkle.at("sealed").access == "private");
}

// Strings declared UTF-8 (`attr(m, utf8)`): the bytes of a valid value are
// those of a raw string; a value that is not UTF-8 is refused when it is
// validated or decoded by a validating reader, and by the validated write.
// The ordinary write packs it (gofractally/psio#14).
namespace utf8_test
{
   struct Notes
   {
      void note(std::int32_t id, std::string text) {}
      void raw(std::string bytes) {}
   };
   PSIO_REFLECT(Notes, method(note, id, attr(text, utf8)), method(raw, bytes))

   // The packed form of `value` with the one occurrence of `marker` in it
   // overwritten by bytes that are not UTF-8.
   template <typename T>
   std::vector<char> spoiled(const T& value, std::string_view marker)
   {
      auto bytes = psio::to_pssz(value);
      auto pos   = std::string_view{bytes.data(), bytes.size()}.find(marker);
      REQUIRE(pos != std::string_view::npos);
      bytes[pos]     = '\xff';
      bytes[pos + 1] = '\xfe';
      return bytes;
   }
}  // namespace utf8_test

TEST_CASE("methods: a string declared UTF-8 refuses other bytes", "[methods][utf8]")
{
   using namespace utf8_test;
   const std::string notUtf8 = "\xff\xfe";

   HttpRequest request{.host        = "QQhost",
                       .method      = "GET",
                       .target      = "/t",
                       .contentType = "text/plain",
                       .headers     = {HttpHeader{"X-Name", "v"}},
                       .body        = {'b'}};
   REQUIRE(psio::validate_pssz<HttpRequest>(psio::to_pssz(request)).ok());
   // Text beyond ASCII is accepted.
   {
      HttpRequest text = request;
      text.host        = "h\xc3\xa9.example";
      CHECK(psio::validate_pssz<HttpRequest>(psio::to_pssz(text)).ok());
   }
   // host, method, contentType and a header's name are UTF-8 ...
   for (std::string_view marker : {"QQhost", "GET", "text/plain", "X-Name"})
   {
      INFO(marker);
      auto bad    = spoiled(request, marker);
      auto status = psio::validate_pssz<HttpRequest>(bad);
      REQUIRE(!status.ok());
      CHECK(std::string_view{status.error().what}.starts_with("utf8"));
#ifndef COMPILING_WASM
      CHECK_THROWS_AS(psio::from_pssz<HttpRequest>(bad), psio::codec_exception);
#endif
   }
   // ... the target, a header's value and the body are not.
   {
      HttpRequest raw      = request;
      raw.target           = notUtf8;
      raw.headers[0].value = notUtf8;
      raw.body             = {'\xff'};
      auto bytes           = psio::to_pssz(raw);
      CHECK(psio::validate_pssz<HttpRequest>(bytes).ok());
   }

   HttpReply reply{.contentType = "text/html", .body = {'x'}, .headers = {HttpHeader{"ETag", "1"}}};
   CHECK(psio::validate_pssz<HttpReply>(psio::to_pssz(reply)).ok());
   CHECK(!psio::validate_pssz<HttpReply>(spoiled(reply, "text/html")).ok());
   CHECK(!psio::validate_pssz<HttpReply>(spoiled(reply, "ETag")).ok());

   LogMessage message{.message = "started", .severity = LogMessage::Severity::info};
   CHECK(psio::validate_pssz<LogMessage>(psio::to_pssz(message)).ok());
   CHECK(!psio::validate_pssz<LogMessage>(spoiled(message, "started")).ok());

   // The ordinary write is the fast write: it packs text that is not UTF-8,
   // and what refuses the bytes is the reader that validates them. The
   // validated write refuses the value itself.
   {
      auto refused = [](const auto& bad)
      {
         const auto bytes = psio::to_pssz(bad);
         CHECK(!psio::validate_pssz<std::remove_cvref_t<decltype(bad)>>(bytes).ok());
         std::vector<char> out;
         CHECK(!psio::encode_pssz_checked(psio::pssz{}, bad, out).ok());
         CHECK(out.empty());
#ifndef COMPILING_WASM
         CHECK_THROWS_AS(psio::to_pssz_checked(bad), psio::codec_exception);
#endif
      };
      HttpRequest bad = request;
      bad.host        = notUtf8;
      refused(bad);
      bad             = request;
      bad.contentType = notUtf8;
      refused(bad);
      bad                 = request;
      bad.headers[0].name = notUtf8;
      refused(bad);
      // What the node packs for x-http::serve.
      bad      = request;
      bad.host = notUtf8;
      refused(std::tuple(std::int32_t{1}, bad));
      HttpReply badReply   = reply;
      badReply.contentType = notUtf8;
      refused(badReply);
      LogMessage badMessage = message;
      badMessage.message    = notUtf8;
      refused(badMessage);
   }

   // A parameter: the argument bytes are those of the plain tuple, and the
   // dispatcher's validation refuses text that is not UTF-8.
   const auto good = psio::method_args_to_pssz<Notes, 0>(7, "caf\xc3\xa9");
   CHECK(good == psio::to_pssz(std::tuple{std::int32_t{7}, std::string{"caf\xc3\xa9"}}));
   CHECK(psio::validate_method_args<Notes, 0>(good).ok());
   const auto badArgs = psio::to_pssz(std::tuple{std::int32_t{7}, notUtf8});
   CHECK(!psio::validate_method_args<Notes, 0>(badArgs).ok());
   CHECK(psio::validate_method_args<Notes, 1>(psio::to_pssz(std::tuple{notUtf8})).ok());
   // A caller packs such an argument (the fast write, as every action
   // builder and Actor does): the bytes are the ones the dispatcher refuses.
   // The validated write refuses the argument at the caller.
   CHECK(psio::method_args_to_pssz<Notes, 0>(7, notUtf8) == badArgs);
   CHECK(psio::to_pssz(psio::reflect<Notes>::method_arg_tuple<0>{7, notUtf8}) == badArgs);
#ifndef COMPILING_WASM
   CHECK_THROWS_AS((psio::method_args_to_pssz_checked<Notes, 0>(7, notUtf8)),
                   psio::codec_exception);
#endif
}
