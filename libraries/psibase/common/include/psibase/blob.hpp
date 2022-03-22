#pragma once

#include <string.h>
#include <algorithm>
#include <type_traits>

namespace psibase
{
   // Compare vector, string, string_view, shared_string (unsigned)
   template <typename A, typename B>
   int compare_blob(const A& a, const B& b)
   {
      static_assert(std::is_same_v<std::decay_t<decltype(*a.data())>, char> ||
                    std::is_same_v<std::decay_t<decltype(*a.data())>, unsigned char>);
      static_assert(std::is_same_v<std::decay_t<decltype(*b.data())>, char> ||
                    std::is_same_v<std::decay_t<decltype(*b.data())>, unsigned char>);
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
