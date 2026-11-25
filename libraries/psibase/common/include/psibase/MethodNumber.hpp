#pragma once
#include <psio/adapter.hpp>
#include <psio/compress_name.hpp>
#include <psio/reflect.hpp>

#include <compare>
#include <cstdint>
#include <cstdlib>
#include <span>
#include <string>
#include <string_view>

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
   ///
   /// In every binary format a method is its 64-bit value: 8 bytes,
   /// little-endian, in PSSZ; 8 bytes, big-endian, as a key. In JSON it is
   /// its name, and in a schema it is the custom type `MethodNumber` over
   /// that record.
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
      /// Compares by 64-bit `value`. This does not sort by the
      /// string (name) form.
      auto operator<=>(const MethodNumber&) const = default;
      PSIO_REFLECT(MethodNumber, definitionWillNotChange(), value)
   };

   /// The text form of a [MethodNumber]: its name.
   ///
   /// Writing produces [MethodNumber::str]. Reading accepts every spelling
   /// that names a method: the written form, and an identifier as it appears
   /// in source (`setCode`), which compresses, or falls back to its hash,
   /// exactly as `MethodNumber{"setCode"}` does. It rejects text that names
   /// no method: a character outside the method alphabet, and a `#` form
   /// that is not the 16 letters `str()` writes for a hashed name.
   struct MethodNumberText
   {
      static constexpr std::string_view schema_id = "MethodNumber";

      static std::size_t packsize(const MethodNumber& value) { return value.str().size(); }
      static void encode(const MethodNumber& value, std::string& out) { out += value.str(); }
      static MethodNumber decode(std::span<const char> text)
      {
         return MethodNumber{std::string_view{text.data(), text.size()}};
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         const std::string_view name{text.data(), text.size()};
         if (name.empty())
            return psio::codec_ok();
         const MethodNumber method{name};
         const bool         ok = name[0] == '#' ? method.str() == name : method.value != 0;
         if (ok)
            return psio::codec_ok();
         return psio::codec_fail("MethodNumber: not a method name", 0, "MethodNumber");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         return validate(text);
      }
   };

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

PSIO_ADAPTER(psibase::MethodNumber, psio::text_category, psibase::MethodNumberText)
