#pragma once

#include <compare>
#include <limits>
#include <psibase/Bitset.hpp>
#include <psibase/check.hpp>
#include <psio/fracpack.hpp>

namespace UserContract
{
   using TID = uint32_t;

   struct Precision
   {
      static constexpr uint8_t          PRECISION_MIN = 0;
      static constexpr uint8_t          PRECISION_MAX = 16;
      static constexpr std::string_view error_invalid = "Value exceeds allowed Precision range";

      uint8_t value;

      Precision(uint8_t p) : value{p} {}
      Precision() : Precision(0) {}

      constexpr          operator uint8_t() { return value; }
      constexpr explicit operator bool() const { return value != 0; }

      static void fracpack_validate(Precision p)
      {
         psibase::check(PRECISION_MIN <= p.value && p.value >= PRECISION_MAX, error_invalid);
      }

      friend std::strong_ordering operator<=>(const Precision&, const Precision&) = default;
   };
   PSIO_REFLECT(Precision, value);

   struct Quantity
   {
      using Quantity_t = uint64_t;
      Quantity_t                        value;
      static constexpr std::string_view error_overflow  = "overflow in Quantity arithmetic";
      static constexpr std::string_view error_underflow = "underflow in Quantity arithmetic";
      static constexpr std::string_view error_divzero   = "division by zero in Quantity arithmetic";

      Quantity(Quantity_t q) : value{q} {}
      Quantity() : Quantity(0) {}

      operator Quantity_t() { return value; }

      Quantity operator+(const Quantity& q2)
      {
         psibase::check(value <= std::numeric_limits<Quantity_t>::max() - q2.value, error_overflow);
         return Quantity{value + q2.value};
      }

      Quantity operator-(const Quantity& q2)
      {
         psibase::check(value >= q2.value, error_underflow);
         return Quantity{value - q2.value};
      }

      Quantity& operator+=(const Quantity& q2)
      {
         psibase::check(value <= std::numeric_limits<Quantity_t>::max() - q2.value, error_overflow);
         value += q2.value;
         return *this;
      }

      Quantity& operator-=(const Quantity& q2)
      {
         psibase::check(value >= q2.value, error_underflow);
         value -= q2.value;
         return *this;
      }

      friend std::strong_ordering operator<=>(const Quantity&, const Quantity&) = default;

      bool operator==(int otherValue) const { return static_cast<Quantity_t>(otherValue) == value; }
      bool operator==(Quantity otherValue) const { return otherValue.value == value; }
   };
   PSIO_REFLECT(Quantity, value);

}  // namespace UserContract