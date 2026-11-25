#include <psizam/gas.hpp>
#include <ucc/typed_int.hpp>
#include "consumer.hpp"

Layout second_layout()
{
    return {sizeof(psizam::gas_units), alignof(psizam::gas_units)};
}
psizam::gas_units increment(psizam::gas_units value)
{
    return psizam::gas_units{value.get_value() + 1};
}
