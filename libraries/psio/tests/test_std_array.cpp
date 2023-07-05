#include "test_fracpack.hpp"

TEST_CASE("roudtrip std::array")
{
   test<std::array<std::int32_t, 3>>({{1, 2, 3}, {4, 5, 6}, {7, 8, 9}});
   test<std::array<std::string, 3>>(
       {{"I have no name", "I am but two days old.", "What shall I call thee?"},
        {"I happy am", "Joy is my name,", "Sweet joy befall thee!"}});
}
