#pragma once
#include <format>
namespace arbtrie {
   template <class Src, class Dst>
   using transcribe_const_t = std::conditional_t<std::is_const<Src>{}, const Dst, Dst>;
   template <class Src, class Dst>
   using transcribe_volatile_t = std::conditional_t<std::is_volatile<Src>{}, Dst volatile, Dst>;
   template <class Src, class Dst>
   using transcribe_cv_t = transcribe_const_t<Src, transcribe_volatile_t<Src, Dst> >;

   template<unsigned int N, typename T>
   T round_up_multiple( T v ) {
      static_assert( std::popcount(N) == 1, "N must be power of 2" );
      return (v + (T(N)-1)) & -T(N);
   }

   template<uint32_t offset, uint32_t width>
   constexpr uint64_t make_mask() {
      static_assert( offset + width <= 64 );
      return (uint64_t(-1) >> (64-width)) << offset;
   }

   // This always returns a view into the first argument
   inline std::string_view common_prefix(std::string_view a, std::string_view b)
   {
      return {a.begin(), std::mismatch(a.begin(), a.end(), b.begin(), b.end()).first};
   }

   inline std::string to_hex( std::string_view sv ) {
      std::string out;
      out.reserve( sv.size()*2 );
      for( auto c : sv )
         out += std::format("{:02x}", uint8_t(c));
      return out;
   }
   inline std::string to_hex( char c ) {
      return std::format("{:02x}", uint8_t(c));
   }
} // namespace arbtrie