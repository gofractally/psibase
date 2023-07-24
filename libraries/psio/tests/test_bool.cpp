#include "test_fracpack.hpp"

TEST_CASE("roundtrip bool")
{
   test<bool>({false, true});
}
