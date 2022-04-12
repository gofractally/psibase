#include <psibase/time.hpp>

#include <algorithm>
#include <chrono>

// TODO remove in c++20
namespace
{
   using days =
       std::chrono::duration<int, std::ratio_multiply<std::ratio<24>, std::chrono::hours::period>>;

   using weeks = std::chrono::duration<int, std::ratio_multiply<std::ratio<7>, days::period>>;

   using years =
       std::chrono::duration<int, std::ratio_multiply<std::ratio<146097, 400>, days::period>>;

   using months = std::chrono::duration<int, std::ratio_divide<years::period, std::ratio<12>>>;

   struct day
   {
      inline explicit day(uint32_t d) : d(d) {}
      uint32_t d;
   };
   struct month
   {
      inline explicit month(uint32_t m) : m(m) {}
      uint32_t m;
   };
   struct month_day
   {
      inline month_day(month m, day d) : m(m), d(d) {}
      inline auto  month() const { return m; }
      inline auto  day() const { return d; }
      struct month m;
      struct day   d;
   };
   struct year
   {
      inline explicit year(uint32_t y) : y(y) {}
      uint32_t y;
   };

   template <class Duration>
   using sys_time = std::chrono::time_point<std::chrono::system_clock, Duration>;

   using sys_days    = sys_time<days>;
   using sys_seconds = sys_time<std::chrono::seconds>;

   typedef year  year_t;
   typedef month month_t;
   typedef day   day_t;
   struct year_month_day
   {
      inline auto from_days(days ds)
      {
         const auto z   = ds.count() + 719468;
         const auto era = (z >= 0 ? z : z - 146096) / 146097;
         const auto doe = static_cast<uint32_t>(z - era * 146097);
         const auto yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
         const auto y   = static_cast<days::rep>(yoe) + era * 400;
         const auto doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
         const auto mp  = (5 * doy + 2) / 153;
         const auto d   = doy - (153 * mp + 2) / 5 + 1;
         const auto m   = mp < 10 ? mp + 3 : mp - 9;
         return year_month_day{year_t{static_cast<uint32_t>(y + (m <= 2))}, month_t(m), day_t(d)};
      }
      inline auto to_days() const
      {
         const auto _y  = static_cast<int>(y.y) - (m.m <= month_t{2}.m);
         const auto _m  = static_cast<uint32_t>(m.m);
         const auto _d  = static_cast<uint32_t>(d.d);
         const auto era = (_y >= 0 ? _y : _y - 399) / 400;
         const auto yoe = static_cast<uint32_t>(_y - era * 400);
         const auto doy = (153 * (_m > 2 ? _m - 3 : _m + 9) + 2) / 5 + _d - 1;
         const auto doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
         return days{era * 146097 + static_cast<int>(doe) - 719468};
      }
      inline year_month_day(const year_t& y, const month_t& m, const day_t& d) : y(y), m(m), d(d) {}
      inline year_month_day(const year_month_day&) = default;
      inline year_month_day(year_month_day&&)      = default;
      inline year_month_day(sys_days ds) : year_month_day(from_days(ds.time_since_epoch())) {}
      inline auto year() const { return y.y; }
      inline auto month() const { return m.m; }
      inline auto day() const { return d.d; }
      year_t      y;
      month_t     m;
      day_t       d;
   };
}  // namespace

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
      sys_days                  sd(std::chrono::floor<days>(us));
      auto                      ymd = year_month_day{sd};
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
      result = sys_days(year_month_day{year_t{y}, month_t{m}, day_t{d}}.to_days())
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

   [[nodiscard]] bool string_to_utc_microseconds(uint64_t&    result,
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
