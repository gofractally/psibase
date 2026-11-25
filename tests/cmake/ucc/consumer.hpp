#pragma once
#include <cstddef>
#include <cstdint>
#include <type_traits>

struct Layout
{
    std::size_t size;
    std::size_t alignment;
};

static_assert(std::is_same_v<psizam::gas_units, ucc::typed_int<std::uint64_t, psizam::gas_tag>>);
static_assert(sizeof(psizam::gas_units) == sizeof(std::uint64_t));
static_assert(alignof(psizam::gas_units) ==
              (PSITRI_PLATFORM_OPTIMIZATIONS ? 1 : alignof(std::uint64_t)));
Layout second_layout();
psizam::gas_units increment(psizam::gas_units);
