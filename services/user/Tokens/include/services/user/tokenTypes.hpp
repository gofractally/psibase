#pragma once

#include <compare>
#include <limits>
#include <psibase/Bitset.hpp>
#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <psio/view.hpp>

namespace UserService
{
   using TID = uint32_t;

   struct Precision
   {
      static constexpr uint8_t precisionMin = 0;
      static constexpr uint8_t precisionMax = 8;

      uint8_t value;

      explicit constexpr Precision(uint8_t p) : value{p} { validate(p); }
      constexpr Precision() : Precision(0) {}

      static constexpr bool validate(const uint8_t& p)
      {
         if (precisionMin > p || p > precisionMax)
         {
            psibase::check(
                false, "Value " + std::to_string(p) + " outside allowed Precision range: " +
                           std::to_string(precisionMin) + " to " + std::to_string(precisionMax));
         }
         return true;
      }

      friend std::strong_ordering operator<=>(const Precision&, const Precision&) = default;
      PSIO_REFLECT(Precision, value);
   };

   inline uint8_t& clio_unwrap_packable(Precision& s)
   {
      return s.value;
   }
   inline const uint8_t& clio_unwrap_packable(const Precision& s)
   {
      return s.value;
   }

   inline bool clio_validate_packable(const Precision& p)
   {
      return Precision::validate(p.value);
   }

   inline bool clio_validate_packable(psio::view<const Precision> p)
   {
      return Precision::validate(p.value());
   }

   void from_json(Precision& p, auto& stream)
   {
      from_json(p.value, stream);
      Precision::validate(p.value);
   }

   void to_json(const Precision& p, auto& stream)
   {
      to_json(p.value, stream);
   }

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
   };  // namespace UserService
   PSIO_REFLECT(Quantity, value);

}  // namespace UserService
