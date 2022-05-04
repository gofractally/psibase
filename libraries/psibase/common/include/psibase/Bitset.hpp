#pragma once

#include <compare>
#include <limits>
#include <psibase/check.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   struct Bitset
   {
      using bitset_t = uint16_t;
      bitset_t bits  = 0;

      bool get(std::size_t pos) const
      {
         _check(pos);
         return static_cast<bool>((bits & (1 << pos)) >> pos);
      }

      void set(std::size_t pos, bool value = true)
      {
         _check(pos);
         if (value)
         {
            bits |= (1 << pos);
         }
         else
         {
            bits &= ~(1 << pos);
         }
      }

      void _check(std::size_t pos) const
      {
         psibase::check(pos >= 0 && pos < MAX_BITS, "out-of-bounds access in bitset");
      }

      friend std::strong_ordering operator<=>(const Bitset&, const Bitset&) = default;
      static constexpr size_t     MAX_BITS = std::numeric_limits<bitset_t>::digits;
   };
   PSIO_REFLECT(Bitset, bits);

}  // namespace psibase
