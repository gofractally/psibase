#pragma once

#include <cstdint>
#include <psibase/NameEncoder.hpp>
#include <ranges>
#include <string>
#include <string_view>

namespace psibase
{
   inline constexpr NameEncoder<std::uint64_t, 10> accountEncoder{36};
   inline constexpr uint64_t                       name_to_number(std::string_view m_input)
   {
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
      return result;
   }  // name_to_number

   inline std::string number_to_name(uint64_t input)
   {
      std::string result;
      accountEncoder.decode(input, 0, [&](std::size_t idx)
                            { result.push_back("-0123456789abcdefghijklmnopqrstuvwxyz"[idx]); });
      return result;
   }
}  // namespace psibase
