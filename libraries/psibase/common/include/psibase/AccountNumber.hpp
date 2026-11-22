#pragma once
#include <psibase/name.hpp>
#include <psio/adapter.hpp>
#include <psio/reflect.hpp>

#include <compare>
#include <cstdint>
#include <cstdlib>
#include <span>
#include <string>
#include <string_view>

namespace psibase
{
   /// An account number or name
   ///
   /// Psibase account numbers are 64-bit values which are compressed
   /// from strings (names). Names may be 0 to 10 characters long and
   /// contain the characters `a-z`, `0-9`, and `-` (hyphen). Names
   /// must not start or end with '-' or contain two consecutive '-'s
   ///
   /// The empty name `""` is value 0.
   ///
   /// In every binary format an account is its 64-bit value: 8 bytes,
   /// little-endian, in PSSZ; 8 bytes, big-endian, as a key (so keys sort
   /// by `value`). In JSON it is its name, and in a schema it is the custom
   /// type `AccountNumber` over that record.
   struct AccountNumber
   {
      using Subaccount                              = std::uint8_t;
      static constexpr std::uint64_t subaccountMask = 0xffu;

      /// Number form
      uint64_t value = 0;

      /// Construct the empty name
      constexpr AccountNumber() : value(0) {}

      /// Construct from 64-bit value
      ///
      /// This doesn't do any checking; if `value` isn't valid, then
      /// [str] will return a string which doesn't round-trip back to
      /// `value`.
      constexpr explicit AccountNumber(uint64_t value) : value(value) {}

      /// Construct from string (name)
      ///
      /// This does minimal checking; if `s` isn't valid, then
      /// [str] will return a string which doesn't match `s`.
      /// Many, but not all, invalid names produce value `0`.
      constexpr explicit AccountNumber(std::string_view s) : value(name_to_number(s)) {}

      /// Construct a subaccount
      constexpr explicit AccountNumber(AccountNumber base, Subaccount sub)
          : value((base.value & ~subaccountMask) | sub)
      {
      }

      static constexpr AccountNumber withSeparator(std::string_view s, std::string_view sep)
      {
         return AccountNumber{name_to_number(s, sep)};
      }

      constexpr Subaccount subaccount() const { return value & subaccountMask; }

      constexpr AccountNumber base() const { return AccountNumber{value & ~subaccountMask}; }

      /// Get string (name)
      std::string str() const { return number_to_name(value); }

      /// Comparisons
      ///
      /// Compares by 64-bit `value`. This does not sort by the
      /// string (name) form.
      friend auto operator<=>(const AccountNumber&, const AccountNumber&) = default;
      PSIO_REFLECT(AccountNumber, definitionWillNotChange(), value)
   };

   /// The text form of an [AccountNumber]: its name.
   ///
   /// Text is read strictly. Exactly one text names each account, the one
   /// [AccountNumber::str] writes; anything else (upper case, a character
   /// outside the alphabet, a misplaced `-`, more than 10 characters, a
   /// subaccount that is not canonical) is rejected rather than mapped to
   /// another account or to 0.
   struct AccountNumberText
   {
      static constexpr std::string_view schema_id = "AccountNumber";

      static std::size_t packsize(const AccountNumber& value) { return value.str().size(); }
      static void encode(const AccountNumber& value, std::string& out) { out += value.str(); }
      static AccountNumber decode(std::span<const char> text)
      {
         return AccountNumber{std::string_view{text.data(), text.size()}};
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         const std::string_view name{text.data(), text.size()};
         if (AccountNumber{name}.str() == name)
            return psio::codec_ok();
         return psio::codec_fail("AccountNumber: not an account name", 0, "AccountNumber");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         return validate(text);
      }
   };

   inline namespace literals
   {
      inline constexpr AccountNumber operator""_a(const char* s, unsigned long)
      {
         auto num = AccountNumber(s);
         if (not num.value)
         {
            std::abort();  // failed_to_compress_name
         }
         return num;
      }
   }  // namespace literals
}  // namespace psibase

PSIO_ADAPTER(psibase::AccountNumber, psio::text_category, psibase::AccountNumberText)
