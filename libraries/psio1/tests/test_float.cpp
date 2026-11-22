#include "test_fracpack.hpp"

TEST_CASE("roundtrip float/double")
{
   test<float>({std::copysign(std::numeric_limits<float>::quiet_NaN(), -1.0f),
                std::copysign(std::numeric_limits<float>::signaling_NaN(), -1.0f),
                -std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::max(),
                -std::numeric_limits<float>::min(), -std::numeric_limits<float>::denorm_min(), -1,
                -0.0f, std::numeric_limits<float>::min(), 0, 1,
                std::numeric_limits<float>::denorm_min(), std::numeric_limits<float>::max(),
                std::numeric_limits<float>::infinity(), std::numeric_limits<float>::signaling_NaN(),
                std::numeric_limits<float>::quiet_NaN()});
   test<double>(
       {std::copysign(std::numeric_limits<double>::quiet_NaN(), -1.0),
        std::copysign(std::numeric_limits<double>::signaling_NaN(), -1.0),
        -std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::max(),
        -std::numeric_limits<double>::min(), -std::numeric_limits<double>::denorm_min(), -1, -0.0,
        std::numeric_limits<double>::min(), 0, 1, std::numeric_limits<double>::denorm_min(),
        std::numeric_limits<double>::max(), std::numeric_limits<double>::infinity(),
        std::numeric_limits<double>::signaling_NaN(), std::numeric_limits<double>::quiet_NaN()});
}
