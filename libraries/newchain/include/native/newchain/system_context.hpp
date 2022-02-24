#pragma once

#include <newchain/db.hpp>
#include <newchain/execution_context.hpp>

namespace newchain
{
   struct system_context
   {
      database&                     db;
      newchain::wasm_cache          wasm_cache;
      std::vector<execution_memory> execution_memories;

      void set_num_memories(size_t n)
      {
         if (n < execution_memories.size())
            execution_memories.resize(n);
         execution_memories.reserve(n);
         while (n > execution_memories.size())
            execution_memories.push_back({});
      }
   };  // system_context

}  // namespace newchain
