#pragma once
#include <compare>

#include <eosio/check.hpp>
#include <eosio/reflection.hpp>
#include <psio/reflect.hpp>

namespace psibase
{
   std::string        microseconds_to_str(uint64_t microseconds);
   [[nodiscard]] bool string_to_utc_seconds(uint32_t&    result,
                                            const char*& s,
                                            const char*  end,
                                            bool         eat_fractional,
                                            bool         require_end);
   [[nodiscard]] bool string_to_utc_microseconds(uint64_t&    result,
                                                 const char*& s,
                                                 const char*  end,
                                                 bool         require_end);

   struct TimePointSec final
   {
      uint32_t seconds                                = 0;
      auto     operator<=>(const TimePointSec&) const = default;
   };
   PSIO_REFLECT(TimePointSec, seconds);
   EOSIO_REFLECT(TimePointSec, seconds);

   template <typename S>
   void from_json(TimePointSec& obj, S& stream)
   {
      auto        s = stream.get_string();
      const char* p = s.data();
      if (!string_to_utc_seconds(obj.seconds, p, s.data() + s.size(), true, true))
      {
         eosio::check(false, "Expected TimePointSec");
      }
   }

   template <typename S>
   void to_json(const TimePointSec& obj, S& stream)
   {
      return to_json(microseconds_to_str(uint64_t(obj.seconds) * 1'000'000), stream);
   }
}  // namespace psibase
