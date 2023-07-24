#include "test_fracpack.hpp"

TEST_CASE("roudtrip [u]int32_t")
{
   test<std::int32_t>({std::numeric_limits<std::int32_t>::min(), -1, 0, 1,
                       std::numeric_limits<std::int32_t>::max()});
   test<std::uint32_t>({0, 1, std::numeric_limits<std::uint32_t>::max()});
}
