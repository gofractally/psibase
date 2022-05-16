#pragma once
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   /// A method number or name
   ///
   /// Psibase method numbers are 64-bit values which are compressed
   /// from strings (names). They contain the characters `a-z`, and
   /// `0-9`. Non-empty names must begin with a letter. `A-Z`
   /// round-trips as `a-z`. `_` (underscore) is dropped.
   ///
   /// There are some names which meet the above rules, but fail to
   /// compress down to 64 bits. These names are invalid. Likewise,
   /// there are some 64-bit integers which aren't the compressed
   /// form of valid names; these are also invalid. Some invalid
   /// names fall back to a hash (below).
   ///
   /// There is a special case when bit 48 is set. `str()` returns
   /// a string which begins with `#` followed by 16 letters. This
   /// is an alternative hex representation which represents the
   /// hash of a name which failed to compress. Once a name is in
   /// this form, it will round trip with no further changes.
   ///
   /// The empty name `""` is value 0.
   struct MethodNumber
   {
      /// Number form
      uint64_t value = 0;

      /// Construct the empty name
      constexpr MethodNumber() : value(0) {}

      /// Construct from 64-bit value
      ///
      /// This doesn't do any checking; if `value` isn't valid, then
      /// [str] will return a string which doesn't round-trip back to
      /// `value`.
      constexpr explicit MethodNumber(uint64_t v) : value(v) {}

      /// Construct from string (name)
      ///
      /// This does minimal checking; if `s` isn't valid, then
      /// [str] will return a string which doesn't match `s`.
      /// Many, but not all, invalid names produce a hashed value.
      /// Some produce 0.
      constexpr explicit MethodNumber(std::string_view s) : value(psio::detail::method_to_number(s))
      {
      }

      /// Get string (name)
      std::string str() const { return psio::detail::number_to_method(value); }

      /// Comparisons
      ///
      /// Compares by 64-bit `value`
      auto operator<=>(const MethodNumber&) const = default;
   };
   PSIO_REFLECT(MethodNumber, definitionWillNotChange(), value)

   template <typename S>
   void to_json(const MethodNumber& n, S& s)
   {
      to_json(n.str(), s);
   }

   template <typename S>
   void from_json(MethodNumber& result, S& stream)
   {
      result = MethodNumber{stream.get_string()};
   }

   inline constexpr bool use_json_string_for_gql(MethodNumber*)
   {
      return true;
   }

   inline namespace literals
   {
      inline constexpr psibase::MethodNumber operator""_m(const char* s, unsigned long)
      {
         auto num = psibase::MethodNumber(s);
         if (not num.value)
         {
            std::abort();  // failed_to_compress_name
         }
         return num;
      }
   }  // namespace literals
}  // namespace psibase
