#pragma once

#include <string.h>
#include <algorithm>
#include <type_traits>

template <typename T>
concept IsByteType =
    std::is_same_v<std::decay_t<T>, char> || std::is_same_v<std::decay_t<T>, unsigned char>;

template <typename T>
concept IsContainerLike = requires(T t) {
   {
      t.data()
   } -> std::convertible_to<const void*>;
   {
      t.size()
   } -> std::convertible_to<std::size_t>;
};

namespace psibase
{
   // Compare vector, string, string_view, shared_string (unsigned)
   template <typename A, typename B>
      requires IsContainerLike<A> && IsContainerLike<B> &&
               IsByteType<decltype(*std::declval<A>().data())> &&
               IsByteType<decltype(*std::declval<B>().data())>
   int compare_blob(const A& a, const B& b)
   {
      auto r = memcmp(a.data(), b.data(), std::min(a.size(), b.size()));
      if (r)
         return r;
      if (a.size() < b.size())
         return -1;
      if (a.size() > b.size())
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
