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

      // TODO: fracpack doesn't enforce yet
      // TODO: from_json doesn't enforce yet
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

      constexpr Quantity(Quantity_t q) : value{q} {}
      constexpr explicit Quantity(double q)
      {
         auto quantity = static_cast<Quantity_t>(q);
         psibase::check(static_cast<double>(quantity) == q, error_overflow);

         value = quantity;
      }
      Quantity() = default;

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

      constexpr auto operator<=>(const Quantity&) const = default;

      constexpr bool operator==(const Quantity& other) const = default;

      constexpr auto operator<=>(const Quantity_t& other) const { return value <=> other; }

      bool operator==(const Quantity_t& otherValue) const { return value == otherValue; }

      constexpr auto operator<=>(const double& other) const
      {
         return value <=> static_cast<Quantity_t>(other);
      }

      bool operator==(const double& otherValue) const
      {
         return value == static_cast<Quantity_t>(otherValue);
      }
   };  // namespace UserContract
   PSIO_REFLECT(Quantity, value);

}  // namespace UserContract