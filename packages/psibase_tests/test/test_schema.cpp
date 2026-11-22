#include <psibase/fileUtil.hpp>
#include <psibase/schema.hpp>
#include <psio1/from_json.hpp>
#include <psio1/schema.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace psibase;
using namespace psio1::schema_types;

TEST_CASE("Verify schema schema")
{
   auto expected   = SchemaBuilder().insert<ServiceSchema>("ServiceSchema").build();
   auto expectedTy = expected.get("ServiceSchema");
   auto schemaJson = readWholeFile("schema-schema.json");
   auto schema = psio1::convert_from_json<Schema>(std::string(schemaJson.begin(), schemaJson.end()));
   auto actualTy = schema.get("ServiceSchema");
   CHECK(expectedTy != nullptr);
   CHECK(actualTy != nullptr);
   if (expectedTy && actualTy)
   {
      auto matcher = psio1::schema_types::TypeMatcher{
          schema,
          expected,
          psio1::SchemaDifference::equivalent,
      };
      CHECK(matcher.match(*actualTy, *expectedTy));
   }
}
