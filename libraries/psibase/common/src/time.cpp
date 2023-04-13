#include <psibase/time.hpp>

#include <algorithm>
#include <chrono>

namespace psibase
{
   std::string microseconds_to_str(uint64_t microseconds)
   {
      std::string result;

      auto append_uint = [&result](uint32_t value, int digits)
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

      std::chrono::microseconds us{microseconds};
      std::chrono::sys_days     sd(std::chrono::floor<std::chrono::days>(us));
      auto                      ymd = std::chrono::year_month_day{sd};
      uint32_t                  ms =
          (std::chrono::floor<std::chrono::milliseconds>(us) - sd.time_since_epoch()).count();
      us -= sd.time_since_epoch();
      append_uint((int)ymd.year(), 4);
      result.push_back('-');
      append_uint((unsigned)ymd.month(), 2);
      result.push_back('-');
      append_uint((unsigned)ymd.day(), 2);
      result.push_back('T');
      append_uint(ms / 3600000 % 60, 2);
      result.push_back(':');
      append_uint(ms / 60000 % 60, 2);
      result.push_back(':');
      append_uint(ms / 1000 % 60, 2);
      result.push_back('.');
      append_uint(ms % 1000, 3);
      result.push_back('Z');
      return result;
   }

   [[nodiscard]] bool string_to_utc_seconds(uint32_t&    result,
                                            const char*& s,
                                            const char*  end,
                                            bool         eat_fractional,
                                            bool         require_end)
   {
      auto parse_uint = [&](uint32_t& result, int digits)
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
      uint32_t y, m, d, h, min, sec;
      if (!parse_uint(y, 4))
         return false;
      if (s == end || *s++ != '-')
         return false;
      if (!parse_uint(m, 2))
         return false;
      if (s == end || *s++ != '-')
         return false;
      if (!parse_uint(d, 2))
         return false;
      if (s == end || *s++ != 'T')
         return false;
      if (!parse_uint(h, 2))
         return false;
      if (s == end || *s++ != ':')
         return false;
      if (!parse_uint(min, 2))
         return false;
      if (s == end || *s++ != ':')
         return false;
      if (!parse_uint(sec, 2))
         return false;
      result = std::chrono::sys_days(std::chrono::year{static_cast<int>(y)} / m / d)
                       .time_since_epoch()
                       .count() *
                   86400 +
               h * 3600 + min * 60 + sec;
      if (eat_fractional && s != end && *s == '.')
      {
         ++s;
         while (s != end && *s >= '0' && *s <= '9')
            ++s;
      }
      if (require_end)
         if (s == end || *s++ != 'Z')
            return false;
      return s == end || !require_end;
   }

   [[nodiscard]] bool stringToUtcMicroseconds(uint64_t&    result,
                                              const char*& s,
                                              const char*  end,
                                              bool         require_end)
   {
      uint32_t sec;
      if (!string_to_utc_seconds(sec, s, end, false, false))
         return false;
      result = sec * 1000000ull;
      if (s == end)
         return true;
      if (*s != '.')
      {
         if (require_end)
            if (s == end || *s++ != 'Z')
               return false;
         return !require_end;
      }
      ++s;
      uint32_t scale = 100000;
      while (scale >= 1 && s != end && *s >= '0' && *s <= '9')
      {
         result += (*s++ - '0') * scale;
         scale /= 10;
      }
      if (require_end)
         if (s == end || *s++ != 'Z')
            return false;
      return s == end || !require_end;
   }
}  // namespace psibase
