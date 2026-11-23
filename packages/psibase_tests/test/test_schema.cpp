#include <psibase/fileUtil.hpp>
#include <psibase/schema.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace psibase;

namespace
{
   struct Tiny
   {
      static constexpr auto service = AccountNumber{"tiny"};
      std::uint32_t         go(std::uint32_t n, std::optional<std::string> note) { return n; }
   };
   PSIO_REFLECT(Tiny, method(go, n, note))
}  // namespace

// doc/src/specifications/data-formats/schema-schema.json is the Schema IR of
// the ServiceSchema record, in I-JSON: psio::SchemaBuilder with the root
// "ServiceSchema", written with psio::format_json(psio::to_ijson(schema)).
TEST_CASE("Verify schema schema")
{
   auto expected = psio::SchemaBuilder().insert<ServiceSchema>("ServiceSchema").build();
   CHECK(psio::pssz_ir::validate_schema(expected).ok());
   auto                       schemaJson = readWholeFile("schema-schema.json");
   psio::schema_types::Schema schema;
   auto status = psio::decode_json_checked(psio::ijson{}, std::span<const char>{schemaJson}, schema);
   INFO(std::string(status.ok() ? std::string_view{} : status.error().what));
   REQUIRE(status.ok());
   CHECK(psio::pssz_ir::validate_schema(schema).ok());
   CHECK(expected.get("ServiceSchema") != nullptr);
   CHECK(schema.get("ServiceSchema") != nullptr);
   auto result = psio::pssz_ir::equivalent(schema, "ServiceSchema", expected, "ServiceSchema",
                                           psio::pssz_ir::compare::contract);
   INFO(result.path << ": " << result.reason);
   CHECK(result.ok);

   // The schema of a service is a value of that type
   auto        value = ServiceSchema::make<Tiny>();
   const auto  bytes = psio::to_pssz(value);
   CHECK(psio::pssz_ir::validate_pssz(schema, "ServiceSchema", std::span<const char>{bytes}).ok());
   const auto  handlers = psibase_types();
   std::string text;
   REQUIRE(psio::pssz_ir::pssz_to_json(schema, "ServiceSchema", psio::ijson{},
                                       std::span<const char>{bytes}, text, nullptr, &handlers)
               .ok());
   CHECK(text == psio::to_ijson(value));
}
