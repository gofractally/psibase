#include "test_fracpack.hpp"

TEST_CASE("roudtrip [u]int16_t")
{
   test<std::int16_t>({-32768, -1, 0, 1, 32767});
   test<std::uint16_t>({0, 1, 65535});
}
