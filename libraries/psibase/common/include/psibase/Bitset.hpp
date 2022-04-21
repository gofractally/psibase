#pragma once

#include <compare>
#include <limits>
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
         eosio::check(pos >= 0 && pos < std::numeric_limits<bitset_t>::digits,
                      "out-of-bounds access in bitset");
      }

      friend std::strong_ordering operator<=>(const Bitset&, const Bitset&) = default;
   };
   EOSIO_REFLECT(Bitset, bits);
   PSIO_REFLECT(Bitset, bits);

}  // namespace psibase
