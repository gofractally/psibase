#pragma once
#include <format>
namespace arbtrie
{
   template <class Src, class Dst>
   using transcribe_const_t = std::conditional_t<std::is_const<Src>{}, const Dst, Dst>;
   template <class Src, class Dst>
   using transcribe_volatile_t = std::conditional_t<std::is_volatile<Src>{}, Dst volatile, Dst>;
   template <class Src, class Dst>
   using transcribe_cv_t = transcribe_const_t<Src, transcribe_volatile_t<Src, Dst> >;

   template <unsigned int N, typename T>
   constexpr T round_up_multiple(T v)
   {
      static_assert(std::popcount(N) == 1, "N must be power of 2");
      return (v + (T(N) - 1)) & -T(N);
   }

   template <uint32_t offset, uint32_t width>
   constexpr uint64_t make_mask()
   {
      static_assert(offset + width <= 64);
      return (uint64_t(-1) >> (64 - width)) << offset;
   }

   // This always returns a view into the first argument
   inline key_view common_prefix(key_view a, key_view b)
   {
      return {a.begin(), std::mismatch(a.begin(), a.end(), b.begin(), b.end()).first};
   }

   inline std::string to_hex(key_view sv)
   {
      std::string out;
      out.reserve(sv.size() * 2);
      for (auto c : sv)
         out += std::format("{:02x}", uint8_t(c));
      return out;
   }
   inline std::string to_hex(char c)
   {
      return std::format("{:02x}", uint8_t(c));
   }
   inline std::string_view to_str(key_view k)
   {
      return std::string_view((const char*)k.data(), k.size());
   }
   inline key_view to_key_view(const std::string& str)
   {
      return key_view((uint8_t*)str.data(), str.size());
   }
   inline value_view to_value_view(const std::string& str)
   {
      return value_view((uint8_t*)str.data(), str.size());
   }

   inline std::string add_comma(uint64_t v)
   {
      auto s = std::to_string(v);
      int n   = s.length() - 3;
      int end = (v >= 0) ? 0 : 1;  // Support for negative numbers
      while (n > end)
      {
         s.insert(n, ",");
         n -= 3;
      }
      return s;
   };
}  // namespace arbtrie
