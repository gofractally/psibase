#include <psio/chrono.hpp>

#include "test_fracpack.hpp"

TEST_CASE("chrono")
{
   test<std::chrono::nanoseconds>({std::chrono::nanoseconds(0), std::chrono::nanoseconds(1),
                                   std::chrono::nanoseconds::min(),
                                   std::chrono::nanoseconds::max()});
}
