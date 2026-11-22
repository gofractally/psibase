#include "test_fracpack.hpp"

TEST_CASE("roundtrip char")
{
   test<char>({'a', 'b', 'c'});
}
