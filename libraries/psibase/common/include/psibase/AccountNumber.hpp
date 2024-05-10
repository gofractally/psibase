#pragma once
#include <compare>
#include <psibase/name.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   /// An account number or name
   ///
   /// Psibase account numbers are 64-bit values which are compressed
   /// from strings (names). Names may be 0 to 18 characters long and
   /// contain the characters `a-z`, `0-9`, and `-` (hyphen).
   /// Non-empty names must begin with a letter.
   ///
   /// There are some names which meet the above rules, but fail to
   /// compress down to 64 bits. These names are invalid. Likewise,
   /// there are some 64-bit integers which aren't the compressed
   /// form of valid names; these are also invalid.
   ///
   /// The empty name `""` is value 0.
   struct AccountNumber
   {
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

      /// Get string (name)
      std::string str() const { return number_to_name(value); }

      /// Comparisons
      ///
      /// Compares by 64-bit `value`. This does not sort by the
      /// string (name) form.
      friend auto operator<=>(const AccountNumber&, const AccountNumber&) = default;
   };
   PSIO_REFLECT(AccountNumber, definitionWillNotChange(), value)

   template <typename S>
   void to_json(const AccountNumber& n, S& s)
   {
      to_json(n.str(), s);
   }

   template <typename S>
   void from_json(AccountNumber& result, S& stream)
   {
      result = AccountNumber{stream.get_string()};
   }

   inline constexpr bool use_json_string_for_gql(AccountNumber*)
   {
      return true;
   }

   inline constexpr bool psio_custom_schema(AccountNumber*)
   {
      return true;
   }

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
