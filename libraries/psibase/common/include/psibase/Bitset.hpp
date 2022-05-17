#pragma once

#include <array>
#include <compare>
#include <concepts>
#include <limits>
#include <psibase/MethodNumber.hpp>
#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <string_view>

namespace psibase
{
   template <uint8_t nrBits>
   struct BitsetTypeMap;

#define MAKE_BITSET_MAP(num, type) \
   template <>                     \
   struct BitsetTypeMap<num>       \
   {                               \
      using inner_t = type;        \
   }

   MAKE_BITSET_MAP(8, uint8_t);
   MAKE_BITSET_MAP(16, uint16_t);
   MAKE_BITSET_MAP(32, uint32_t);
   MAKE_BITSET_MAP(64, uint64_t);

   template <uint8_t nrBits>
   concept validNrBits = std::integral<typename BitsetTypeMap<nrBits>::inner_t>;

   template <uint8_t nrBits>

   // TODO: consider adding std::bitset to fracpack, to_json, and from_json instead
   struct Bitset
   {
      static_assert(validNrBits<nrBits>, "Unsupported Bitset size. Supported sizes: 8, 16, 32, 64");

      using Bitset_t                   = typename BitsetTypeMap<nrBits>::inner_t;
      // TODO: rename; UPPERCASE_IS_FOR_MACROS_ONLY
      static constexpr size_t MAX_BITS = std::numeric_limits<Bitset_t>::digits;
      Bitset_t                bits     = 0;

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
         psibase::check(pos < MAX_BITS, "out-of-bounds access in bitset");
      }

      constexpr auto operator<=>(const Bitset<nrBits>&) const = default;
   };
   using Bitset_8  = Bitset<8>;
   using Bitset_16 = Bitset<16>;
   using Bitset_32 = Bitset<32>;
   using Bitset_64 = Bitset<64>;
   PSIO_REFLECT(Bitset_8, bits);
   PSIO_REFLECT(Bitset_16, bits);
   PSIO_REFLECT(Bitset_32, bits);
   PSIO_REFLECT(Bitset_64, bits);

   using NamedBit_t = psibase::MethodNumber;
   template <psibase::MethodNumber... Args>
   class NamedBits
   {
     public:
      static const size_t      nrBits  = sizeof...(Args);
      // TODO: rename; UPPERCASE_IS_FOR_MACROS_ONLY
      static constexpr uint8_t INVALID = std::numeric_limits<uint8_t>::max();

      static constexpr uint8_t getIndex(NamedBit_t flag)
      {
         std::size_t i = 0;
         while (i < _flags.size())
         {
            if (flag == _flags[i])
            {
               return static_cast<uint8_t>(i);
            }
            ++i;
         }

         return INVALID;
      }

     private:
      static constexpr std::array<NamedBit_t, nrBits> _flags = {{Args...}};
   };

}  // namespace psibase
