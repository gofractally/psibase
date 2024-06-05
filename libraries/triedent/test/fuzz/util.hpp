#pragma once

std::string wrap_input(void*, std::string&& arg, int)
{
   return std::move(arg);
}

template <typename T>
std::pair<std::string, T> wrap_input(T*, std::string&& arg, int n)
{
   return {std::move(arg), static_cast<T>(n % static_cast<int>(T::num))};
}

template <typename T = void>
std::vector<decltype(wrap_input((T*)nullptr, std::string{}, 0))> parse_vector(
    const std::uint8_t* data,
    std::size_t         size)
{
   std::vector<decltype(wrap_input((T*)nullptr, std::string{}, 0))> result;
   std::string                                                      key;
   bool                                                             escape = false;
   for (auto ch : std::span{data, size})
   {
      if (escape)
      {
         if (ch == 0)
         {
            key.push_back(ch);
         }
         else
         {
            if (key.size() >= 192)
               return {};
            result.push_back(wrap_input((T*)nullptr, std::move(key), static_cast<int>(ch)));
         }
         escape = false;
      }
      else
      {
         if (ch == 0)
         {
            escape = true;
         }
         else
         {
            key.push_back(ch);
         }
      }
   }
   return result;
}

inline void dumphex(std::string_view s)
{
   const char* digits = "0123456789ABCDEF";
   for (char ch : s)
   {
      std::cout << "\\x";
      std::cout << digits[(ch >> 4) & 0xf];
      std::cout << digits[ch & 0xf];
   }
}

template <typename T>
void dumphex(const std::pair<std::string, T>& p)
{
   dumphex(p.second);
   dumphex(p.first);
}

template <typename T>
void dump(const std::vector<T>& contents, std::string_view lower, std::string_view upper)
{
   std::cout << '{' << std::endl;
   for (const auto& row : contents)
   {
      std::cout << '"';
      dumphex(row);
      std::cout << '"';
      std::cout << "sv";
      std::cout << ',';
      std::cout << std::endl;
   }
   std::cout << '}' << std::endl;
   std::cout << ',';
   std::cout << '"';
   dumphex(lower);
   std::cout << '"';
   std::cout << "sv";
   std::cout << ',';
   std::cout << '"';
   dumphex(upper);
   std::cout << '"';
   std::cout << "sv";
   std::cout << std::endl;
}
