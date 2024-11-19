#include <psio/chrono.hpp>

namespace psio
{

   std::string format_system_time(std::int64_t sec, std::uint64_t subsec, int digits)
   {
      std::string result;

      auto append_uint = [&result](uint64_t value, int digits)
      {
         char  s[20];
         char* ch = s;
         while (digits--)
         {
            *ch++ = '0' + (value % 10);
            value /= 10;
         };
         std::reverse(s, ch);
         result.insert(result.end(), s, ch);
      };

      std::chrono::sys_seconds s{std::chrono::seconds{sec}};
      std::chrono::sys_days    sd(std::chrono::floor<std::chrono::days>(s));
      auto                     ymd  = std::chrono::year_month_day{sd};
      auto                     time = (s - sd).count();
      append_uint((int)ymd.year(), 4);
      result.push_back('-');
      append_uint((unsigned)ymd.month(), 2);
      result.push_back('-');
      append_uint((unsigned)ymd.day(), 2);
      result.push_back('T');
      append_uint(time / 3600 % 60, 2);
      result.push_back(':');
      append_uint(time / 60 % 60, 2);
      result.push_back(':');
      append_uint(time % 60, 2);
      if (digits != 0)
      {
         result.push_back('.');
         append_uint(subsec, digits);
      }
      result.push_back('Z');
      return result;
   }

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
      if (m < 1 || m > 12)
         return false;
      static constexpr uint32_t days_in_month[12] = {31, 29, 31, 30, 31, 30,
                                                     31, 31, 30, 31, 30, 31};
      if (d < 1 || d > days_in_month[m - 1])
         return false;
      if (m == 2 && d == 29 && (y % 4 != 0 || (y % 100 == 0 && y % 400 != 0)))
         return false;
      if (h > 24 || min > 59 || sec > 60)
         return false;
      if (sec == 60)
         sec = 59;
      result = std::chrono::sys_days(std::chrono::year{static_cast<int>(y)} / m / d)
                       .time_since_epoch()
                       .count() *
                   86400 +
               h * 3600 + min * 60 + sec;
      nsec = 0;
      if (parse_char('.') || parse_char(','))
      {
         uint32_t scale = 100000000;
         while (s != end && *s >= '0' && *s <= '9')
         {
            nsec += scale * (*s - '0');
            scale /= 10;
            ++s;
         }
      }
      if (h == 24 && (min != 0 || sec != 0 || nsec != 0))
         return false;
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
      else
      {
         return false;
      }
      return s == end;
   }
}  // namespace psio
