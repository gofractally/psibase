#pragma once

#include <algorithm>
#include <charconv>
#include <compare>
#include <limits>
#include <optional>
#include <psibase/check.hpp>
#include <psio/adapter.hpp>
#include <psio/annotate.hpp>
#include <psio/invariant.hpp>
#include <psio/reflect.hpp>
#include <psio/transparent.hpp>
#include <span>
#include <string>
#include <string_view>
#include <tuple>

namespace UserService
{
   using TID = uint32_t;

   /// The number of decimal places of a token: 0 to 8.
   ///
   /// A precision is its number wherever it is serialized (`transparent()`).
   /// A reader that checks its input rejects a number above 8
   /// (`invariant(inRange)`), with a message that names the number.
   struct Precision
   {
      static constexpr uint8_t precisionMin = 0;
      static constexpr uint8_t precisionMax = 8;

      uint8_t value;

      explicit constexpr Precision(uint8_t p) : value{p} { validate(p); }
      constexpr Precision() : Precision(0) {}

      /// "Value 9 outside allowed Precision range: 0 to 8"
      static std::string outOfRange(uint8_t p)
      {
         return "Value " + std::to_string(p) + " outside allowed Precision range: " +
                std::to_string(precisionMin) + " to " + std::to_string(precisionMax);
      }
      static constexpr bool validate(const uint8_t& p)
      {
         if (precisionMin > p || p > precisionMax)
         {
            psibase::check(false, outOfRange(p));
         }
         return true;
      }
      static psio::codec_status inRange(const Precision& p) noexcept
      {
         if (precisionMin > p.value || p.value > precisionMax)
            return psio::codec_fail_owned(outOfRange(p.value), 0, "Precision");
         return psio::codec_ok();
      }

      friend std::strong_ordering operator<=>(const Precision&, const Precision&) = default;
      PSIO_REFLECT(Precision, transparent(), invariant(inRange), value)
   };

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

   struct Decimal
   {
      Quantity  quantity;
      Precision precision;

      constexpr Decimal() = default;
      constexpr Decimal(Quantity q, Precision p) : quantity(q), precision(p) {}

      std::string str() const
      {
         if (precision.value == 0)
         {
            return std::to_string(quantity.value);
         }

         uint64_t divisor         = pow10_unsafe(precision.value);
         uint64_t integer_part    = quantity.value / divisor;
         uint64_t fractional_part = quantity.value % divisor;

         std::string result = std::to_string(integer_part);
         result.reserve(result.length() + 1 + precision.value);
         result += '.';
         result += format_fractional_part(fractional_part, precision.value);
         return result;
      }

      /// The value `s` spells, or nothing if `s` is not a decimal number:
      /// digits with at most one '.', at least one digit, at most 8 digits
      /// after the point, and a quantity that fits 64 bits. Never aborts.
      static std::optional<Decimal> parse(std::string_view s) noexcept
      {
         const auto             dot      = s.find('.');
         const std::string_view integer  = s.substr(0, dot);
         const std::string_view fraction = dot == std::string_view::npos ? std::string_view{}
                                                                         : s.substr(dot + 1);
         constexpr uint64_t     max      = std::numeric_limits<uint64_t>::max();
         if (integer.empty() && fraction.empty())
            return std::nullopt;
         if (fraction.size() > Precision::precisionMax)
            return std::nullopt;
         auto digits = [](std::string_view text, uint64_t& out)
         {
            out = 0;
            for (char c : text)
            {
               if (c < '0' || c > '9')
                  return false;
               const uint64_t digit = static_cast<uint64_t>(c - '0');
               if (out > (max - digit) / 10)
                  return false;
               out = out * 10 + digit;
            }
            return true;
         };
         uint64_t integerValue  = 0;
         uint64_t fractionValue = 0;
         if (!digits(integer, integerValue) || !digits(fraction, fractionValue))
            return std::nullopt;
         uint64_t scale = 1;
         for (std::size_t i = 0; i < fraction.size(); ++i)
            scale *= 10;
         if (integerValue > max / scale)
            return std::nullopt;
         const uint64_t whole = integerValue * scale;
         if (fractionValue > max - whole)
            return std::nullopt;
         return Decimal{Quantity{whole + fractionValue},
                        Precision{static_cast<uint8_t>(fraction.size())}};
      }

      static Decimal fromStr(std::string_view s)
      {
         validate_decimal_string(s);
         auto [integer_part, fraction_part, precision_val] = split_decimal_string(s);
         Precision prec{precision_val};

         uint64_t quantity_val = 0;
         if (!integer_part.empty())
         {
            quantity_val = parse_integer_part(integer_part, precision_val);
         }
         if (!fraction_part.empty())
         {
            quantity_val += parse_fraction_part(fraction_part, precision_val);
         }

         return Decimal{Quantity{quantity_val}, prec};
      }

     private:
      static uint64_t pow10_unsafe(uint8_t exp)
      {
         uint64_t result = 1;
         for (uint8_t i = 0; i < exp; ++i)
         {
            result *= 10;
         }
         return result;
      }

      static std::string format_fractional_part(uint64_t value, uint8_t precision)
      {
         char     frac_buf[21];
         char*    ch  = frac_buf;
         uint64_t val = value;
         for (uint8_t i = 0; i < precision; ++i)
         {
            *ch++ = '0' + (val % 10);
            val /= 10;
         }
         std::reverse(frac_buf, ch);
         return std::string(frac_buf, ch - frac_buf);
      }

      static void validate_decimal_string(std::string_view s)
      {
         bool has_digit = false;
         for (char c : s)
         {
            if (c != '.' && !std::isdigit(static_cast<unsigned char>(c)))
            {
               psibase::abortMessage("Invalid number: contains non-digit characters");
            }
            if (std::isdigit(static_cast<unsigned char>(c)))
            {
               has_digit = true;
            }
         }
         psibase::check(has_digit, "Invalid number: must contain at least one digit");
      }

      static std::tuple<std::string_view, std::string_view, uint8_t> split_decimal_string(
          std::string_view s)
      {
         auto dot_pos = s.find('.');
         if (dot_pos != std::string_view::npos)
         {
            return {s.substr(0, dot_pos), s.substr(dot_pos + 1),
                    static_cast<uint8_t>(s.substr(dot_pos + 1).length())};
         }
         return {s, "", 0};
      }

      static uint64_t parse_u64(std::string_view str)
      {
         if (str.empty())
            return 0;
         uint64_t result;
         auto [ptr, ec] = std::from_chars(str.data(), str.data() + str.length(), result);
         psibase::check(ec == std::errc() && ptr == str.data() + str.length(),
                        "Invalid number: parse error");
         return result;
      }

      static uint64_t pow10_safe(uint8_t exp)
      {
         uint64_t result = 1;
         for (uint8_t i = 0; i < exp; ++i)
         {
            psibase::check(result <= std::numeric_limits<uint64_t>::max() / 10,
                           "Invalid number: overflow");
            result *= 10;
         }
         return result;
      }

      static uint64_t parse_integer_part(std::string_view integer_part, uint8_t precision_val)
      {
         uint64_t integer_value = parse_u64(integer_part);
         uint64_t multiplier    = pow10_safe(precision_val);
         psibase::check(integer_value <= std::numeric_limits<uint64_t>::max() / multiplier,
                        "Invalid number: overflow");
         return integer_value * multiplier;
      }

      static uint64_t parse_fraction_part(std::string_view fraction_part, uint8_t precision_val)
      {
         uint64_t fraction_value = parse_u64(fraction_part);
         uint8_t  remaining_pow  = precision_val - static_cast<uint8_t>(fraction_part.length());
         uint64_t multiplier     = pow10_safe(remaining_pow);
         psibase::check(fraction_value <= std::numeric_limits<uint64_t>::max() / multiplier,
                        "Invalid number: overflow");
         return fraction_value * multiplier;
      }
   };
   PSIO_REFLECT(Decimal, quantity, precision);

   /// The text form of a Decimal: the quantity written with the precision's
   /// number of digits after the point ("12.50" is 1250 at precision 2; the
   /// precision is part of the value, so "12.5" is another one).
   ///
   /// `validate` accepts every spelling `Decimal::parse` reads; a missing
   /// integer part (".5"), a trailing point ("5.") and leading zeros
   /// included. `validate_strict` accepts only the spelling `str()` writes.
   struct DecimalText
   {
      static std::size_t packsize(const Decimal& d) { return d.str().size(); }
      static void        encode(const Decimal& d, std::string& out) { out += d.str(); }
      static Decimal     decode(std::span<const char> text)
      {
         return Decimal::fromStr(std::string_view{text.data(), text.size()});
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         if (Decimal::parse(std::string_view{text.data(), text.size()}))
            return psio::codec_ok();
         return psio::codec_fail("Decimal: not a decimal number", 0, "Decimal");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         const std::string_view spelled{text.data(), text.size()};
         if (auto value = Decimal::parse(spelled); value && value->str() == spelled)
            return psio::codec_ok();
         return psio::codec_fail("Decimal: not the canonical spelling of a decimal number", 0,
                                 "Decimal");
      }
   };

}  // namespace UserService

PSIO_ADAPTER(UserService::Decimal, psio::text_category, UserService::DecimalText)
