#include "test_fracpack.hpp"

TEST_CASE("roundtrip [u]int8_t")
{
   test<std::int8_t>({-128, -1, 0, 1, 127});
   test<std::uint8_t>({0, 1, 255});
}
