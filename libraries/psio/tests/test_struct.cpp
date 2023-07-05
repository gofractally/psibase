#include "test_fracpack.hpp"

struct fixed_struct
{
   std::uint32_t value;
   friend bool   operator==(const fixed_struct&, const fixed_struct&) = default;
};
PSIO_REFLECT(fixed_struct, definitionWillNotChange(), value)

struct padded_struct
{
   std::uint8_t  v1;
   std::uint32_t v2;
   friend bool   operator==(const padded_struct&, const padded_struct&) = default;
};
PSIO_REFLECT(padded_struct, definitionWillNotChange(), v1, v2)

struct variable_struct
{
   std::uint32_t value;
   friend bool   operator==(const variable_struct&, const variable_struct&) = default;
};
PSIO_REFLECT(variable_struct, value)

TEST_CASE("roudtrip structs")
{
   test<fixed_struct>({{0x12345678}, {0x90abcdef}});
   test<padded_struct>({{42, 0x12345678}, {43, 0x90abcdef}});
   test<variable_struct>({{0x12345678}, {0x90abcdef}});
}
