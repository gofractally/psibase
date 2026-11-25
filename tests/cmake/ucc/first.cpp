#include <ucc/typed_int.hpp>
#include <psizam/gas.hpp>
#include "consumer.hpp"

int main()
{
    auto other = second_layout();
    return other.size != sizeof(psizam::gas_units) ||
           other.alignment != alignof(psizam::gas_units) ||
           increment(psizam::gas_units{17}).get_value() != 18;
}
