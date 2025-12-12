#include <services/user/Subgroups.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/checkSchema.hpp>

using namespace UserService;
using namespace psibase;

TEST_CASE("schema")
{
   CHECK_SCHEMA(SubgroupsService);
}
