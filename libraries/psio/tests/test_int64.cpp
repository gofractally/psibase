#include "test_fracpack.hpp"

TEST_CASE("roudtrip [u]int64_t")
{
   test<std::int64_t>({std::numeric_limits<std::int64_t>::min(), -1, 0, 1,
                       std::numeric_limits<std::int64_t>::max()});
   test<std::uint64_t>({0, 1, std::numeric_limits<std::uint64_t>::max()});
}
