#pragma once

#include "stdint.h"

namespace psibase
{
   enum class kv_map : uint32_t
   {
      contract,              // Contract tables
      native_constrained,    // Native tables which enforce constraints during write
      native_unconstrained,  // Native tables which don't enforce constraints during write
      subjective,            // Data that is not part of consensus
      write_only,            // Write-only during transactions. Readable during RPC.
   };
}
