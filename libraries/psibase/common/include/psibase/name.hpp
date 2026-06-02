#pragma once

#include <charconv>
#include <cstdint>
#include <psibase/NameEncoder.hpp>
#include <ranges>
#include <string>
#include <string_view>

namespace psibase
{
   namespace detail
   {
      inline constexpr std::string_view subaccountSeparator = "☺";

      // removes and encodes the trailing subaccount
      constexpr std::uint8_t subaccount_from_str(std::string_view& s)
      {
         auto pos = s.find(subaccountSeparator);
         if (pos == std::string_view::npos)
         {
            return 0;
         }
         std::uint8_t sub;
         const char*  start = s.data() + pos + subaccountSeparator.size();
         const char*  end   = s.data() + s.size();
         auto         res   = std::from_chars(start, end, sub);
         if (res.ec == std::errc{} && res.ptr == end)
         {
            s = s.substr(0, pos);
            return sub;
         }
         else
         {
            return 0;
         }
      }

      constexpr void subaccount_to_str(std::uint8_t sub, std::string& out)
      {
         if (sub != 0)
         {
            out += subaccountSeparator;
            out += std::to_string(sub);
         }
      }
   }  // namespace detail

   inline constexpr NameEncoder<std::uint64_t, 10> accountEncoder{36};
   inline constexpr uint64_t                       name_to_number(std::string_view m_input)
   {
      auto sub    = detail::subaccount_from_str(m_input);
      auto result = accountEncoder.encode(m_input | std::views::transform(
                                                        [](char ch) -> std::uint64_t
                                                        {
                                                           if (ch == '-')
                                                           {
                                                              return 0;
                                                           }
                                                           else if (ch >= '0' && ch <= '9')
                                                           {
                                                              return ch - '0' + 1;
                                                           }
                                                           else if (ch >= 'A' && ch <= 'Z')
                                                           {
                                                              return ch - 'A' + 11;
                                                           }
                                                           else if (ch >= 'a' && ch <= 'z')
                                                           {
                                                              return ch - 'a' + 11;
                                                           }
                                                           return -1;
                                                        }),
                                          0);
      if (result == -1)
         return 0;
      return (result << 8) + sub;
   }  // name_to_number

   inline std::string number_to_name(uint64_t input)
   {
      auto        sub = input & 0xffu;
      std::string result;
      accountEncoder.decode(input >> 8, 0, [&](std::size_t idx)
                            { result.push_back("-0123456789abcdefghijklmnopqrstuvwxyz"[idx]); });
      detail::subaccount_to_str(sub, result);
      return result;
   }
}  // namespace psibase
