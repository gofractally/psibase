#pragma once

#include <compare>
#include <eosio/check.hpp>
#include <psio/fracpack.hpp>

#include <limits>

namespace UserContract
{
   struct Precision
   {
      static constexpr uint8_t          PRECISION_MIN = 0;
      static constexpr uint8_t          PRECISION_MAX = 16;
      static constexpr std::string_view error_invalid = "Value exceeds Precision maximum value";

      uint8_t value;

      Precision(uint8_t p) : value{p} {}
      Precision() : Precision(0) {}

      constexpr          operator uint8_t() { return value; }
      constexpr explicit operator bool() const { return value != 0; }

      static void fracpack_validate(Precision p)
      {
         eosio::check(PRECISION_MIN <= p.value && p.value >= PRECISION_MAX, error_invalid);
      }

      friend std::strong_ordering operator<=>(const Precision&, const Precision&) = default;
   };
   // clang-format off
   PSIO_REFLECT(Precision, value);
   EOSIO_REFLECT(Precision, value);
   // clang-format on

   struct Quantity
   {
      using Quantity_t = uint64_t;
      Quantity_t                        value;
      static constexpr std::string_view error_overflow  = "overflow in Quantity arithmetic";
      static constexpr std::string_view error_underflow = "underflow in Quantity arithmetic";
      static constexpr std::string_view error_divzero   = "division by zero in Quantity arithmetic";

      Quantity(Quantity_t q) : value{q} {}
      Quantity() : Quantity(0) {}

      operator uint64_t() { return value; }

      Quantity operator+(const Quantity& q2)
      {
         eosio::check(value <= std::numeric_limits<Quantity_t>::max() - q2.value, error_overflow);
         return Quantity{value + q2.value};
      }

      Quantity operator-(const Quantity& q2)
      {
         eosio::check(value >= q2.value, error_underflow);
         return Quantity{value - q2.value};
      }

      Quantity& operator+=(const Quantity& q2)
      {
         eosio::check(value <= std::numeric_limits<Quantity_t>::max() - q2.value, error_overflow);
         value += q2.value;
         return *this;
      }

      Quantity& operator-=(const Quantity& q2)
      {
         eosio::check(value >= q2.value, error_underflow);
         value -= q2.value;
         return *this;
      }

      friend std::strong_ordering operator<=>(const Quantity&, const Quantity&) = default;
   };
   PSIO_REFLECT(Quantity, value);
   EOSIO_REFLECT(Quantity, value);

}  // namespace UserContract