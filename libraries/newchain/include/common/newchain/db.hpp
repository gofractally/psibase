#pragma once

#include "stdint.h"

namespace newchain
{
   enum class kv_map : uint32_t
   {
      contract,              // Contract tables
      native_constrained,    // Native tables which enforce constraints during write
      native_unconstrained,  // Native tables which don't enforce constraints during write
   };
}
