#pragma once
#include <tuple>

namespace psio
{
   enum class tuple_error
   {
      no_error,
      invalid_tuple_index
   };  // tuple_error

   constexpr inline std::string_view error_to_str(tuple_error e)
   {
      switch (e)
      {
            // clang-format off
         case tuple_error::no_error:                  return "No error";
         case tuple_error::invalid_tuple_index:       return "invalid tuple index";
         default:                                     return "unknown";
            // clang-format on
      }
   }

   template <int N, typename T, typename L>
   void tuple_get(T& obj, int pos, L&& lambda)
   {
      if constexpr (N < std::tuple_size_v<T>)
      {
         if (N == pos)
         {
            lambda(std::get<N>(obj));
         }
         else
            tuple_get<N + 1>(obj, pos, std::forward<L>(lambda));
      }
      else
      {
         abort_error(tuple_error::invalid_tuple_index);
      }
   }

   template <typename... T, typename L>
   void tuple_get(std::tuple<T...>& obj, int pos, L&& lambda)
   {
      tuple_get<0>(obj, pos, std::forward<L>(lambda));
   }

   template <int N, typename T, typename L>
   void tuple_for_each(T& obj, L&& lambda)
   {
      if constexpr (N < std::tuple_size_v<T>)
      {
         lambda(N, std::get<N>(obj));
         tuple_for_each<N + 1>(obj, std::forward<L>(lambda));
      }
   }

   template <typename... T, typename L>
   void tuple_for_each(std::tuple<T...>& obj, L&& lambda)
   {
      tuple_for_each<0>(obj, std::forward<L>(lambda));
   }

   template <int N, typename T, typename L>
   void tuple_for_each(const T& obj, L&& lambda)
   {
      if constexpr (N < std::tuple_size_v<T>)
      {
         lambda(N, std::get<N>(obj));
         tuple_for_each<N + 1>(obj, std::forward<L>(lambda));
      }
   }

   template <typename... T, typename L>
   void tuple_for_each(const std::tuple<T...>& obj, L&& lambda)
   {
      tuple_for_each<0>(obj, std::forward<L>(lambda));
   }

}  // namespace psio
