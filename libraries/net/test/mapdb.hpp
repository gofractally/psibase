#pragma once

#include <tuple>
#include <map>
#include <cstddef>
#include <utility>

struct prefix_compare
{
   template<typename T0, typename T1, std::size_t... I>
   bool compare(const T0& lhs, const T1& rhs, std::index_sequence<I...>) const
   {
      return std::tie(std::get<I>(lhs)...) < std::tie(std::get<I>(rhs)...);
   }
   using is_transparent = void;
   template<typename... T, typename... U>
   bool operator()(const std::tuple<T...>& lhs, const std::tuple<U...>& rhs) const
   {
      return compare(lhs, rhs, std::make_index_sequence<std::min(sizeof...(T), sizeof...(U))>{});
   }
   template<typename... T, typename U>
   bool operator()(const std::tuple<T...>& lhs, const U& rhs) const
   {
      return std::get<0>(lhs) < rhs;
   };
   template<typename T, typename... U>
   bool operator()(const T& lhs, const std::tuple<U...>& rhs) const
   {
      return lhs < std::get<0>(rhs);
   }
   template<typename T, typename U>
   bool operator()(const T& lhs, const U& rhs) const
   {
      return lhs < rhs;
   }
};

struct mapdb
{
   template<typename K, typename V>
   using index = std::map<K, V, prefix_compare>;
};
