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

   using Seconds      = std::chrono::duration<std::int64_t>;
   using MicroSec     = std::chrono::duration<std::int64_t, std::micro>;
   using TimePointSec = std::chrono::time_point<std::chrono::system_clock, Seconds>;

   using TimePointUSec = std::chrono::time_point<std::chrono::system_clock, MicroSec>;

}  // namespace psibase
