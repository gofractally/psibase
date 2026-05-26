#pragma once

#include <array>
#include <cstddef>

namespace psibase
{
   // Valid names:
   // - Any number of regular chars, one separator
   // - Fixed maximum length
   // - Must not start or end with separator
   // - Must not contain two consecutive separators
   //
   // Encoding constraints:
   // - Numeric ordering matches string ordering
   // - There are no gaps in the encoded space
   // - 0 maps to "", which is reserved
   // - Values larger than zzzzzzzzzz are not mapped
   //
   // This means that the encoding of any name is equal
   // to the number of other names less than it.
   //
   // The implementation works by precomputing the number
   // of name suffixes of length N. There are two numbers
   // for each length, one including and one excluding
   // strings beginning with the separator.
   //
   // This can be calculated using a recurrence relation, by
   // noting that
   // - The empty suffix is allowed only if the previous char
   //   was not a separator, which is identical to the condition
   //   for allowing the suffix to start with a separator¹
   // - If the first char is not a separator, then the rest
   //   can start with a separator
   // - If the first char is a separator, then the rest must
   //   not start with a separator
   // These three cases are disjoint and cover all possible suffixes.
   //
   // |     | 0 |   1 |        2 |               i |
   // | --- | - | --- | -------- | --------------- |
   // | y_i | 1 | C+1 | C^2+2C+1 | x_{i}+x_{i-1}+1 |
   // | x_i | 0 | C   | C^2+C    | C*y_{i-1}       |
   //
   // ¹ There is one special case at the beginning of the string,
   //   because the empty string is accepted, but a name cannot
   //   start with a separator, but that is handled at the top level.
   //
   // Once we have the number of suffixes of each length, we can
   // sum the number of lesser names that diverge at each position
   // in the string to get the final encoding.

   template <typename T>
   struct NameCount
   {
      T withSep;
      T withoutSep;
   };

   template <typename T, std::size_t N>
   struct NameEncoder
   {
      constexpr NameEncoder(T numRegularChars) : numRegularChars(numRegularChars), tailCounts{}
      {
         tailCounts[0].withSep    = 1;
         tailCounts[0].withoutSep = 0;
         for (std::size_t i = 1; i < tailCounts.size(); ++i)
         {
            tailCounts[i].withoutSep = numRegularChars * tailCounts[i - 1].withSep;
            tailCounts[i].withSep    = tailCounts[i - 1].withoutSep + tailCounts[i].withoutSep + 1;
         }
      }

      constexpr T max() const { return numRegularChars * tailCounts[N - 1].withSep; }

      constexpr T encode(auto&& rng, T sepIdx) const
      {
         T           result    = 0;
         std::size_t maxlen    = N;
         bool        allowsSep = false;
         bool        allowsEnd = true;
         for (T idx : rng)
         {
            if (maxlen == 0 || idx > numRegularChars + 1 || (idx == sepIdx && !allowsSep))
               return -1;
            // Count the prefix
            if (allowsEnd)
               result += 1;
            // Count names with lower chars in this position
            if (idx <= sepIdx)
            {
               result += idx * tailCounts[maxlen - 1].withSep;
            }
            else
            {
               result += (idx - 1) * tailCounts[maxlen - 1].withSep;
               if (allowsSep)
                  result += tailCounts[maxlen - 1].withoutSep;
            }
            allowsEnd = allowsSep = idx != sepIdx;
            --maxlen;
         }
         if (!allowsEnd)
            return -1;
         return result;
      }

      template <typename F>
      constexpr F decode(T value, T sepIdx, F out) const
      {
         if (value > max())
            return out;
         std::size_t maxlen    = N;
         bool        allowsSep = false;
         bool        allowsEnd = true;
         while (value != 0 || !allowsEnd)
         {
            if (allowsEnd)
               value -= 1;
            auto tail = tailCounts[maxlen - 1].withSep;
            T    idx  = 0;
            if (allowsSep)
            {
               auto tailSep = tailCounts[maxlen - 1].withoutSep;
               if (value >= tail * sepIdx + tailSep)
               {
                  value -= tailSep;
                  idx += 1;
               }
            }
            else if (value >= tail * sepIdx)
            {
               idx += 1;
            }
            idx += value / tail;
            value %= tail;
            out(idx);
            allowsEnd = allowsSep = idx != sepIdx;
            --maxlen;
         }
         return out;
      }

      T                           numRegularChars;
      std::array<NameCount<T>, N> tailCounts;
   };
}  // namespace psibase
