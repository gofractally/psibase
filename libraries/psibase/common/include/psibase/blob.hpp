#pragma once

#include <string.h>
#include <algorithm>
#include <ranges>
#include <type_traits>

template <typename T>
concept IsByteType = std::is_same_v<T, char> || std::is_same_v<T, unsigned char>;

template <typename T>
concept IsByteRange = std::ranges::contiguous_range<T> && std::ranges::sized_range<T> &&
                      IsByteType<std::remove_cvref_t<std::ranges::range_value_t<T>>>;

namespace psibase
{
   // Compare vector, string, string_view, shared_string (unsigned)
   template <typename A, typename B>
      requires IsByteRange<A> && IsByteRange<B>
   int compare_blob(const A& a, const B& b)
   {
      auto min_size = std::min(std::ranges::size(a), std::ranges::size(b));
      auto r = min_size == 0 ? 0 : memcmp(std::ranges::data(a), std::ranges::data(b), min_size);
      if (r)
         return r;
      if (std::ranges::size(a) < std::ranges::size(b))
         return -1;
      if (std::ranges::size(a) > std::ranges::size(b))
         return 1;
      return 0;
   }

   // Compare vector, string, string_view, shared_string (unsigned)
   struct blob_less
   {
      template <typename A, typename B>
      bool operator()(const A& a, const B& b) const
      {
         return compare_blob(a, b) < 0;
      }
   };

}  // namespace psibase
