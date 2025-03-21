#pragma once
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace psio
{

   template <typename SrcIt, typename DestIt>
   void hex(SrcIt begin, SrcIt end, DestIt dest, std::optional<char> delimiter = std::nullopt)
   {
      auto nibble = [&dest](std::uint8_t i)
      {
         if (i <= 9)
            *dest++ = '0' + i;
         else
            *dest++ = 'A' + i - 10;
      };

      bool first = true;
      while (begin != end)
      {
         if (!first && delimiter)
            *dest++ = *delimiter;
         first = false;

         nibble(((std::uint8_t)*begin) >> 4);
         nibble(((std::uint8_t)*begin) & 0xf);
         ++begin;
      }
   }

   template <typename SrcIt>
   std::string hex(SrcIt begin, SrcIt end, std::optional<char> delimiter = std::nullopt)
   {
      std::string s;
      size_t      size = (end - begin) * 2;
      if (delimiter && begin != end)
         size += (end - begin - 1);
      s.reserve(size);
      hex(begin, end, std::back_inserter(s), delimiter);
      return s;
   }

   inline std::string to_hex(const std::span<const char>& bytes,
                             std::optional<char>          delimiter = std::nullopt)
   {
      return hex(bytes.begin(), bytes.end(), delimiter);
   }

   inline bool from_hex(std::string_view h, std::vector<char>& bytes)
   {
      bytes.resize(h.size() / 2);
      auto dest = bytes.begin();

      auto begin     = h.begin();
      auto end       = h.end();
      auto get_digit = [&](std::uint8_t& nibble)
      {
         if (*begin >= '0' && *begin <= '9')
            nibble = *begin++ - '0';
         else if (*begin >= 'a' && *begin <= 'f')
            nibble = *begin++ - 'a' + 10;
         else if (*begin >= 'A' && *begin <= 'F')
            nibble = *begin++ - 'A' + 10;
         else
            return false;
         return true;
      };
      while (begin != end)
      {
         std::uint8_t h, l;
         if (!get_digit(h) || !get_digit(l))
            return false;
         *dest++ = (h << 4) | l;
      }
      return true;
   }

}  // namespace psio
