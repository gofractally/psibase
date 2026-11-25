#include <services/test/TestResult.hpp>

#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/schema.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

using namespace psibase;
using namespace TestService;

namespace
{
   namespace st = psio::schema_types;

   // The node `type` names, through the references of the schema
   const st::AnyType& resolved(const ServiceSchema& schema, const st::AnyType& type)
   {
      const auto* node = type.resolve(schema.types);
      REQUIRE(node != nullptr);
      return *node;
   }
   // `type` is a string of the kind `id` ("utf8", "string"): its bound, if
   // it has one
   std::optional<std::uint64_t> stringBound(const ServiceSchema& schema,
                                            const st::AnyType&   type,
                                            std::string_view     id)
   {
      const auto& custom = std::get<st::Custom>(resolved(schema, type).value);
      CHECK(custom.id == id);
      const auto& bytes = resolved(schema, *custom.type).value;
      if (const auto* bounded = std::get_if<st::BoundedList>(&bytes))
         return bounded->maxCount;
      CHECK(std::holds_alternative<st::List>(bytes));
      return std::nullopt;
   }
}  // namespace

// A result is what `returns(...)` makes of the return type, in the schema
// of the service and for a caller (gofractally/psibase#2235).
TEST_CASE("an annotated result: the schema")
{
   const auto strict = ServiceSchema::make<TestResult>();
   const auto loose  = ServiceSchema::make<TestResultLoose>();
   REQUIRE(strict.actions.at("symbol").result.has_value());
   REQUIRE(strict.actions.at("names").result.has_value());

   // returns(utf8 | max<8>): UTF-8 of at most 8 bytes
   CHECK(stringBound(strict, **strict.actions.at("symbol").result, "utf8") == 8u);
   // returns(max<4> | element(utf8 | max<16>)): at most 4 such strings
   {
      const auto& list = std::get<st::BoundedList>(
          resolved(strict, **strict.actions.at("names").result).value);
      CHECK(list.maxCount == 4);
      CHECK(stringBound(strict, *list.type, "utf8") == 16u);
   }
   // Without returns(...) the result is the plain type: a raw string
   // without a bound
   CHECK(stringBound(loose, **loose.actions.at("symbol").result, "string") == std::nullopt);
   CHECK(std::holds_alternative<st::List>(
       resolved(loose, **loose.actions.at("names").result).value));

   // The two declarations are not one contract, and the difference is the
   // result.
   auto same = psio::pssz_ir::equivalent(strict.types, **strict.actions.at("symbol").result,
                                         loose.types, **loose.actions.at("symbol").result,
                                         psio::pssz_ir::compare::contract);
   CHECK(!same.ok);

   // A schema-driven reader checks a result against the node
   const auto good = psio::method_result_to_pssz<TestResult, 0>(std::string{"USD"});
   const auto long9 = psio::to_pssz(std::string{"123456789"});
   const auto& node = **strict.actions.at("symbol").result;
   CHECK(psio::pssz_ir::validate_pssz(strict.types, node, std::span<const char>{good}).ok());
   CHECK(!psio::pssz_ir::validate_pssz(strict.types, node, std::span<const char>{long9}).ok());
}

TEST_CASE("an annotated result: the caller checks what it receives")
{
   DefaultTestChain t;
   t.addService(TestResult::service, "TestResult.wasm");
   // The same service at a second account: a callee that declares its
   // results (a service does not call itself).
   const auto strict = AccountNumber{"test-res2"};
   t.addService(strict, "TestResult.wasm");
   t.addService(TestResultLoose::service, "TestResultLoose.wasm");

   auto svc = t.from(TestResult::service).to<TestResult>();
   const auto loose  = TestResultLoose::service;
   const std::vector<std::string> two(2, "alice");

   // The bytes of a result are those of the annotated type: a list of
   // strings under returns(max<4> | element(max<16>)) has one-byte offsets.
   CHECK(psio::method_result_to_pssz<TestResult, 1>(two).size() == 2 + 10);
   CHECK(psio::to_pssz(two).size() == 2 * 4 + 10);

   // A result inside returns(...): from a callee that declares it and from
   // one that does not.
   CHECK(svc.relay(strict, 0).returnVal() == "USD");
   CHECK(svc.relay(loose, 0).returnVal() == "USD");
   CHECK(svc.relayView(strict, 0).returnVal() == "USD");
   CHECK(svc.relayView(loose, 0).returnVal() == "USD");
   CHECK(svc.relayNames(strict, 2).returnVal() == two);
   CHECK(svc.relayNamesView(strict, 2).returnVal() == two);
   CHECK(svc.relayNames(strict, 0).returnVal().empty());
   CHECK(svc.relayNamesView(strict, 4).returnVal().size() == 4);

   // A callee does not write a result outside its own returns(...): the
   // action aborts, called directly or by another service.
   CHECK(svc.relay(strict, 1).failed("length_bound"));
   CHECK(svc.symbol(1).failed("length_bound"));
   CHECK(svc.symbol(2).failed("utf8"));
   CHECK(svc.names(5).failed("length_bound"));

   // The caller refuses one from a callee that promises less: nine bytes,
   // bytes that are not UTF-8, and a list packed with the offsets of the
   // plain type (any count: it is another encoding).
   const std::string_view refused = "value returned from symbol was not serialized as expected";
   CHECK(svc.relay(loose, 1).failed(refused));
   CHECK(svc.relay(loose, 2).failed(refused));
   CHECK(svc.relayView(loose, 1).failed(refused));
   CHECK(svc.relayView(loose, 2).failed(refused));
   const std::string_view refusedNames =
       "value returned from names was not serialized as expected";
   CHECK(svc.relayNames(loose, 2).failed(refusedNames));
   CHECK(svc.relayNamesView(loose, 2).failed(refusedNames));
   CHECK(svc.relayNames(loose, 5).failed(refusedNames));
}
