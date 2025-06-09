#pragma once

#include <chrono>
#include <concepts>
#include <limits>
#include <type_traits>

namespace psibase
{
   template <std::integral To, std::integral From>
   constexpr To saturatingCast(From from)
   {
      if constexpr (std::is_signed_v<From>)
      {
         if constexpr (std::is_signed_v<To>)
         {
            if (from < std::numeric_limits<To>::min())
               return std::numeric_limits<To>::min();
            else if (from > std::numeric_limits<To>::max())
               return std::numeric_limits<To>::max();
         }
         else
         {
            if (from < 0)
               return 0;
            else if (static_cast<std::make_unsigned_t<From>>(from) > std::numeric_limits<To>::max())
            {
               return std::numeric_limits<To>::max();
            }
         }
      }
      else
      {
         if (from > static_cast<std::make_unsigned_t<To>>(std::numeric_limits<To>::max()))
         {
            return std::numeric_limits<To>::max();
         }
      }
      return static_cast<To>(from);
   }

   template <std::integral T>
   constexpr T saturatingMultiply(T lhs, T rhs)
   {
      if (lhs == 0 || rhs == 0)
         return 0;
      if constexpr (std::is_signed_v<T>)
      {
         if ((lhs < 0) != (rhs < 0))
         {
            // Avoid min/-1
            if (rhs < 0)
            {
               if (std::numeric_limits<T>::min() / lhs > rhs)
                  return std::numeric_limits<T>::min();
            }
            else
            {
               if (std::numeric_limits<T>::min() / rhs > lhs)
                  return std::numeric_limits<T>::min();
            }
            return lhs * rhs;
         }
      }
      if (std::numeric_limits<T>::max() / lhs < rhs)
         return std::numeric_limits<T>::max();
      else
         return static_cast<T>(lhs * rhs);
   }

   template <typename R, typename Rep, typename Period>
      requires std::integral<Rep> && std::integral<typename R::rep>
   constexpr R saturatingCast(std::chrono::duration<Rep, Period> value)
   {
      using factor = std::ratio_divide<Period, typename R::period>;
      if constexpr (factor::num == 1 && factor::den == 1)
      {
         return R{saturatingCast<typename R::rep>(value.count())};
      }
      else if constexpr (factor::num == 1)
      {
         if constexpr (factor::den > std::numeric_limits<Rep>::max())
         {
            // value = min, den = max+1 = -min should give -1
            if constexpr (std::is_signed_v<Rep> && std::is_signed_v<typename R::rep> &&
                          factor::den - 1 == std::numeric_limits<Rep>::max())
            {
               if (value.count() < -std::numeric_limits<Rep>::max())
                  return R{static_cast<typename R::rep>(-1)};
            }
            return R::zero();
         }
         else
         {
            return R{saturatingCast<typename R::rep>(value / static_cast<R>(factor::den))};
         }
      }
      else if constexpr (factor::den == 1)
      {
         static_assert(factor::num > 0, "Negative ratio not supported");
         // value=-1, num = max+1 should give min, not -max.
         if constexpr (std::is_signed_v<Rep> && factor::num > 0 &&
                       factor::num - 1 == std::numeric_limits<typename R::rep>::max())
         {
            if (value.count() == -1)
               return R{-std::numeric_limits<typename R::rep>::max() - 1};
         }
         return R{saturatingMultiply(saturatingCast<typename R::rep>(value.count()),
                                     saturatingCast<typename R::rep>(factor::num))};
      }
      else
      {
         static_assert(factor::den == 1 || factor::num == 1, "Not implemented");
      }
   }
}  // namespace psibase
