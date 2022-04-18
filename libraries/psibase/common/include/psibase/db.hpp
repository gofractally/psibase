#pragma once

#include "stdint.h"

namespace psibase
{
   //  vector< map<key,val> > similar to enumerated index into vector
   enum class kv_map : uint32_t /* TODO?: rename to kvdb_arena (kv_map used in external library) */
   {
      contract,              // Contract tables
      native_constrained,    // Native tables which enforce constraints during write
      native_unconstrained,  // Native tables which don't enforce constraints during write
      subjective,            // Data that is not part of consensus
      write_only,            // Write-only during transactions. Readable during RPC,
                             //   also subjectively writable by node operator.
      block_log,             // Not available during transactions. Readable during RPC.
      event,                 // Events
      ui_event,              // User Interface Events (short-lived)
   };
}  // namespace psibase
