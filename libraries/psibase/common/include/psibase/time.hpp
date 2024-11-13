#pragma once
#include <compare>
#include <psibase/check.hpp>
#include <psio/chrono.hpp>
#include <psio/reflect.hpp>

namespace psibase
{
   using Seconds       = std::chrono::duration<std::int64_t>;
   using MicroSec      = std::chrono::duration<std::int64_t, std::micro>;
   using TimePointSec  = std::chrono::time_point<std::chrono::system_clock, Seconds>;
   using TimePointUSec = std::chrono::time_point<std::chrono::system_clock, MicroSec>;
}  // namespace psibase
