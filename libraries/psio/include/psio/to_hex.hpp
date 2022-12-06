#pragma once
#include <string>

namespace psio
{

   template <typename SrcIt, typename DestIt>
   void hex(SrcIt begin, SrcIt end, DestIt dest)
   {
      auto nibble = [&dest](uint8_t i)
      {
         if (i <= 9)
            *dest++ = '0' + i;
         else
            *dest++ = 'A' + i - 10;
      };
      while (begin != end)
      {
         nibble(((uint8_t)*begin) >> 4);
         nibble(((uint8_t)*begin) & 0xf);
         ++begin;
      }
   }

   template <typename SrcIt>
   std::string hex(SrcIt begin, SrcIt end)
   {
      std::string s;
      s.reserve((end - begin) * 2);
      hex(begin, end, std::back_inserter(s));
      return s;
   }

   inline std::string to_hex(const std::span<const char>& bytes)
   {
      std::string out;
      out.resize(bytes.size() * 2);
      auto itr = out.begin();
      for (uint8_t byte : bytes)
      {
         *itr = hex_digits[byte >> 4];
         ++itr;
         *itr = hex_digits[byte & 0x0f];
         ++itr;
      }
      return out;
   }

   inline bool from_hex(std::string_view h, std::vector<char>& bytes)
   {
      bytes.resize(h.size() / 2);
      auto dest = bytes.begin();

      auto begin     = h.begin();
      auto end       = h.end();
      auto get_digit = [&](uint8_t& nibble)
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
         uint8_t h, l;
         if (!get_digit(h) || !get_digit(l))
            return false;
         *dest++ = (h << 4) | l;
      }
      return true;
   }

}  // namespace psio
