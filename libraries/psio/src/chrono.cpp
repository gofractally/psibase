#include <psio/chrono.hpp>

namespace psio
{

   bool parse_system_time(std::string_view str, int64_t& result, uint32_t& nsec)
   {
      const char* s          = str.data();
      const char* end        = str.data() + str.size();
      auto        parse_uint = [&](uint32_t& result, int digits)
      {
         result = 0;
         while (digits--)
         {
            if (s != end && *s >= '0' && *s <= '9')
               result = result * 10 + *s++ - '0';
            else
               return false;
         }
         return true;
      };
      auto parse_char = [&](char ch)
      {
         if (s != end && *s == ch)
         {
            ++s;
            return true;
         }
         return false;
      };
      auto parse_str = [&](std::string_view match)
      {
         if (std::string_view(s, end).starts_with(match))
         {
            s += match.size();
            return true;
         }
         return false;
      };
      uint32_t y, m, d, h, min, sec;
      if (!parse_uint(y, 4) || !parse_char('-') || !parse_uint(m, 2) || !parse_char('-') ||
          !parse_uint(d, 2))
         return false;
      if (!parse_char('T') || !parse_uint(h, 2) || !parse_char(':') || !parse_uint(min, 2) ||
          !parse_char(':') || !parse_uint(sec, 2))
         return false;
      if (h > 24 || min > 59 || sec > 60)
         return false;
      result = std::chrono::sys_days(std::chrono::year{static_cast<int>(y)} / m / d)
                       .time_since_epoch()
                       .count() *
                   86400 +
               h * 3600 + min * 60 + sec;
      if (parse_char('.') || parse_char(','))
      {
         ++s;
         uint32_t scale = 100000000;
         while (s != end && *s >= '0' && *s <= '9')
         {
            nsec += scale * (*s - '0');
            scale /= 10;
            ++s;
         }
      }
      if (parse_char('Z'))
      {
      }
      else if (parse_char('+'))
      {
         if (!parse_uint(h, 2))
            return false;
         if (parse_char(':') & !parse_uint(min, 2))
            return false;
         if (h > 14 || min > 59)
            return false;
         result -= (h * 60 + min) * 60;
      }
      else if (parse_char('-') || parse_str("\u2212"))
      {
         if (!parse_uint(h, 2))
            return false;
         if (parse_char(':') & !parse_uint(min, 2))
            return false;
         if (h > 14 || min > 59)
            return false;
         if (h == 0 && min == 0)
            return false;
         result += (h * 60 + min) * 60;
      }
      return s == end;
   }
}  // namespace psio
