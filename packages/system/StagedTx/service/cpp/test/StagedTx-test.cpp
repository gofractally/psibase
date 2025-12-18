#include <services/system/StagedTx.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/checkSchema.hpp>

using namespace SystemService;

TEST_CASE("schema")
{
   CHECK_SCHEMA(StagedTxService);
}
