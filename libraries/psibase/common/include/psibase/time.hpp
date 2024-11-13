#pragma once
#include <compare>
#include <psibase/check.hpp>
#include <psio/chrono.hpp>
#include <psio/reflect.hpp>

namespace psibase
{
   std::string        microseconds_to_str(uint64_t microseconds);
   [[nodiscard]] bool string_to_utc_seconds(uint32_t&    result,
                                            const char*& s,
                                            const char*  end,
                                            bool         eat_fractional,
                                            bool         require_end);
   [[nodiscard]] bool stringToUtcMicroseconds(uint64_t&    result,
                                              const char*& s,
                                              const char*  end,
                                              bool         require_end);

#if 0
   
   struct TimePointSec
   {
      uint32_t seconds                                = 0;
      auto     operator<=>(const TimePointSec&) const = default;
      PSIO_REFLECT(TimePointSec, definitionWillNotChange(), seconds);
   };

   template <typename S>
   void from_json(TimePointSec& obj, S& stream)
   {
      auto        s = stream.get_string();
      const char* p = s.data();
      if (!string_to_utc_seconds(obj.seconds, p, s.data() + s.size(), true, true))
      {
         check(false, "Expected TimePointSec");
      }
   }

   template <typename S>
   void to_json(const TimePointSec& obj, S& stream)
   {
      return to_json(microseconds_to_str(uint64_t(obj.seconds) * 1'000'000), stream);
   }

   inline constexpr bool use_json_string_for_gql(TimePointSec*)
   {
      return true;
   }

#endif

   using Seconds      = std::chrono::duration<std::int64_t>;
   using MicroSec     = std::chrono::duration<std::int64_t, std::micro>;
   using TimePointSec = std::chrono::time_point<std::chrono::system_clock, Seconds>;

   using TimePointUSec = std::chrono::time_point<std::chrono::system_clock, MicroSec>;

}  // namespace psibase
