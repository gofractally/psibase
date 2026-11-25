#pragma once
#include <psio/time.hpp>

#include <chrono>
#include <cstdint>

namespace psibase
{
   // Time values are std::chrono types, which PSIO serializes itself
   // (psio/time.hpp): a duration is its tick count; a system_clock time point
   // is its tick count since the Unix epoch in every binary format (so keys
   // sort chronologically) and an RFC 3339 UTC string in JSON.
   using Seconds       = std::chrono::duration<std::int64_t>;
   using MicroSeconds  = std::chrono::duration<std::int64_t, std::micro>;
   using TimePointSec  = std::chrono::time_point<std::chrono::system_clock, Seconds>;
   using TimePointUSec = std::chrono::time_point<std::chrono::system_clock, MicroSeconds>;

   // Monotonic (steady_clock) time points have no epoch that another node, or
   // another run of this node, shares. PSIO has no form for them: psio/time.hpp
   // accepts system_clock time points only (see doc/pssz-conversion.md).
   using MonotonicTimePointSec  = std::chrono::time_point<std::chrono::steady_clock, Seconds>;
   using MonotonicTimePointUSec = std::chrono::time_point<std::chrono::steady_clock, MicroSeconds>;
}  // namespace psibase
