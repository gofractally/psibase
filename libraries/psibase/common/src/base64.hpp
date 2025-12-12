#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <ranges>

namespace psibase::detail
{
   constexpr std::array<char, 64> base64Table(char c62, char c63)
   {
      std::array<char, 64> result = {};
      auto                 pos    = result.begin();
      pos = std::ranges::copy(std::ranges::views::iota('A', static_cast<char>('Z' + 1)), pos).out;
      pos = std::ranges::copy(std::ranges::views::iota('a', static_cast<char>('z' + 1)), pos).out;
      pos = std::ranges::copy(std::ranges::views::iota('0', static_cast<char>('9' + 1)), pos).out;
      *pos++ = c62;
      *pos++ = c63;
      if (pos != result.end())
         abortMessage("Size mismatch");
      return result;
   }

   constexpr std::array<std::int8_t, 256> invert(std::array<char, 64> tab)
   {
      std::array<std::int8_t, 256> result = {};
      for (auto& ch : result)
      {
         ch = -1;
      }
      std::int8_t i = 0;
      for (auto ch : tab)
      {
         result[static_cast<unsigned char>(ch)] = i;
         ++i;
      }
      return result;
   }

   constexpr unsigned mask(int bits)
   {
      return (unsigned(1) << bits) - 1;
   }

   // Encoding may add padding bits, decoding removes padding
   template <int SrcBits, int DstBits, bool Encode>
   auto transcode(const auto& in, auto out)
   {
      unsigned buf  = 0;
      int      bits = 0;
      for (unsigned char ch : in)
      {
         buf = (buf << SrcBits) | ch;
         bits += SrcBits;
         while (bits >= DstBits)
         {
            bits -= DstBits;
            out((buf >> bits) & mask(DstBits));
         }
      }
      if constexpr (Encode)
      {
         if (bits != 0)
         {
            out((buf << (DstBits - bits)) & mask(DstBits));
         }
      }
      else
      {
         return (buf & mask(bits)) == 0;
      }
   }
}  // namespace psibase::detail
